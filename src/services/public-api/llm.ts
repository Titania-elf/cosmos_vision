import { getRequestHeaders } from '@sillytavern/script';
import yaml from 'yaml';
import type { PromptLlmAccount, PromptLlmSettings } from '@/constants/prompt-llm';
import { getAvailablePromptLlmAccounts, getPromptLlmRequestAccounts } from '@/services/prompt-llm/router';
import {
  buildCustomApi,
  type TavernHelperJsonSchema,
  type TavernHelperRolePrompt,
} from '@/services/tavern-helper/prompt-llm';
import { CHAT_COMPLETION_SOURCE_OPTIONS, findProxyPreset } from '@/services/sillytavern/openai-config';
import { PublicApiError, throwIfAborted } from './errors';
import { isRecord } from './validation';

const SUPPORTED_SOURCES = new Set(CHAT_COMPLETION_SOURCE_OPTIONS.map(source => source.value));
const RESERVED_BODY_FIELDS = new Set([
  'messages',
  'prompt',
  'model',
  'stream',
  'n',
  'response_format',
  'tools',
  'tool_choice',
]);

function readConnection(account: PromptLlmAccount): { url: string; key: string } | null {
  if (!SUPPORTED_SOURCES.has(account.source.trim())) return null;
  const preset = account.proxyPreset.trim() ? findProxyPreset(account.proxyPreset.trim()) : null;
  if (account.proxyPreset.trim() && !preset) return null;
  const rawUrl = preset?.url ?? account.apiUrl;
  try {
    const url = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.pathname = url.pathname.replace(/\/(?:chat\/completions|completions)\/?$/, '').replace(/\/+$/, '');
    return { url: url.toString().replace(/\/$/, ''), key: preset?.password ?? account.apiKey.trim() };
  } catch {
    return null;
  }
}

export function getProvidedLlmError(settings: PromptLlmSettings): string | undefined {
  return getAvailablePromptLlmAccounts(settings).some(account => readConnection(account))
    ? undefined
    : '请配置并启用可用的提示词 LLM 账号；引用的酒馆代理预设也必须存在。';
}

/** 在任务开始时解析连接配置，之后不再读取当前代理预设或其他全局状态。 */
export function snapshotProvidedLlmConfig(settings: PromptLlmSettings): Record<string, unknown> {
  const account = getPromptLlmRequestAccounts(settings).find(candidate => readConnection(candidate));
  const connection = account && readConnection(account);
  if (!account || !connection) throw new PublicApiError('LLM_NOT_CONFIGURED', getProvidedLlmError(settings)!);
  const api = buildCustomApi(settings, account);
  const payload: Record<string, unknown> = {
    chat_completion_source: account.source.trim(),
    model: account.model.trim(),
    reverse_proxy: connection.url,
    proxy_password: connection.key,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    top_p: settings.topP,
    top_k: settings.topK,
    stream: false,
    n: 1,
  };
  if (account.source.trim() === 'custom') {
    const body = api.custom_include_body ?? {};
    if (
      Object.keys(body).some(key => RESERVED_BODY_FIELDS.has(key)) ||
      (api.custom_exclude_body ?? []).some(key => RESERVED_BODY_FIELDS.has(key))
    ) {
      throw new PublicApiError(
        'UNSUPPORTED_CONTEXT',
        '自定义 LLM 参数不能覆盖或排除公开接口的消息、模型、张数或结构化输出字段。',
      );
    }
    const headers = { ...api.custom_include_headers };
    if (connection.key) {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'authorization') delete headers[key];
      headers.Authorization = `Bearer ${connection.key}`;
    }
    payload.custom_url = connection.url;
    payload.custom_include_body = yaml.stringify(body);
    payload.custom_exclude_body = yaml.stringify(api.custom_exclude_body ?? []);
    payload.custom_include_headers = yaml.stringify(headers);
  }
  return payload;
}

/**
 * supplied-only 请求直达酒馆后端。generateRaw 即便覆盖消息仍会读角色、触发世界书并改动聊天，
 * 因此此处只复用 Cosmos 的账号路由/参数解析，不进入聊天生成链或 ST 宏展开。
 * 单次提交，不在收到不确定的失败后自动重试其他账号。
 */
export async function requestProvidedPrompt(
  config: Record<string, unknown>,
  messages: TavernHelperRolePrompt[],
  schema: TavernHelperJsonSchema | undefined,
  signal: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const response = await fetch('/api/backends/chat-completions/generate', {
    method: 'POST',
    headers: getRequestHeaders(),
    signal,
    body: JSON.stringify({ ...config, messages, json_schema: schema }),
  });
  throwIfAborted(signal);
  if (!response.ok) throw new PublicApiError('GENERATION_FAILED', `提示词服务请求失败（HTTP ${response.status}）。`);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new PublicApiError('INVALID_RESPONSE', '提示词服务未返回有效响应。');
  }
  throwIfAborted(signal);
  const text = readCompletionText(value, schema?.name);
  if (!text) throw new PublicApiError('INVALID_RESPONSE', '提示词服务未返回可读取的文本结果。');
  return text;
}

/** 酒馆可能返回 OpenAI 兼容结果、Claude 内容块或 Gemini 内容块，只取最终文本。 */
function readCompletionText(value: unknown, schemaName?: string): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.error) throw new PublicApiError('GENERATION_FAILED', '提示词服务返回错误，请检查模型与接口配置。');
  if (Array.isArray(value.choices) && isRecord(value.choices[0])) {
    const first = value.choices[0];
    if (typeof first.text === 'string') return first.text;
    if (isRecord(first.message)) {
      const calls = first.message.tool_calls;
      if (schemaName && Array.isArray(calls)) {
        const call = calls.find(call => isRecord(call) && isRecord(call.function) && call.function.name === schemaName);
        if (isRecord(call) && isRecord(call.function) && typeof call.function.arguments === 'string')
          return call.function.arguments;
      }
      const content = readTextBlocks(first.message.content);
      if (content) return content;
    }
  }
  if (schemaName && Array.isArray(value.content)) {
    const tool = value.content.find(block => isRecord(block) && block.type === 'tool_use' && block.name === schemaName);
    if (isRecord(tool) && isRecord(tool.input)) return JSON.stringify(tool.input);
  }
  const content = readTextBlocks(value.content);
  if (content) return content;
  if (Array.isArray(value.candidates) && isRecord(value.candidates[0]) && isRecord(value.candidates[0].content)) {
    return readTextBlocks(value.candidates[0].content.parts);
  }
  return undefined;
}

function readTextBlocks(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  return (
    content
      .filter(
        block =>
          isRecord(block) &&
          typeof block.text === 'string' &&
          block.thought !== true &&
          (block.type === undefined || block.type === 'text'),
      )
      .map(block => (block as { text: string }).text)
      .join('') || undefined
  );
}
