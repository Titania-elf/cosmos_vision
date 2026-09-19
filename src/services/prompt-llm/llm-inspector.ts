import type { PromptLlmAccount, PromptLlmContext } from '@/constants/prompt-llm';
import type { TavernHelperGenerateRawConfig, TavernHelperRolePrompt } from '@/services/tavern-helper/prompt-llm';

/** 监视会话中的单条发送指令 */
export interface LlmInspectorPromptEntry {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM 监视请求快照（发送侧，可安全展示） */
export interface LlmInspectorRequestSnapshot {
  /** generation_id，与流式事件对账 */
  id: string;
  /** 会话标签（焦点段落摘要） */
  label: string;
  startedAt: number;
  prompts: LlmInspectorPromptEntry[];
  model: string;
  /** 连接方式展示（酒馆代理预设名或接口地址） */
  endpoint: string;
  accountName: string;
  streamEnabled: boolean;
}

/**
 * 构建内联生图 LLM 请求的监视快照
 * 快照在每次账号尝试构建请求时生成；多账号故障转移时后尝试覆盖先尝试
 * @param id generation_id
 * @param request generateRaw 请求体
 * @param account 本次尝试账号
 * @param label 会话标签
 * @returns 可展示的请求快照
 */
export function buildLlmInspectorRequestSnapshot(
  id: string,
  request: TavernHelperGenerateRawConfig,
  account: PromptLlmAccount | undefined,
  label: string,
): LlmInspectorRequestSnapshot {
  return {
    id,
    label,
    startedAt: Date.now(),
    prompts: readSnapshotPrompts(request.ordered_prompts),
    model: request.custom_api?.model?.trim() || '(未配置)',
    endpoint: readSnapshotEndpoint(request, account),
    accountName: account ? account.name.trim() || '(未命名账号)' : '(默认账号)',
    streamEnabled: Boolean(request.should_stream),
  };
}

/**
 * 读取发送指令列表（仅取角色消息，忽略纯字符串条目并如实降级为 user）
 * @param orderedPrompts 请求消息列表
 * @returns 指令快照列表
 */
function readSnapshotPrompts(
  orderedPrompts: Array<string | TavernHelperRolePrompt> | undefined,
): LlmInspectorPromptEntry[] {
  return (orderedPrompts ?? []).map(prompt => {
    if (typeof prompt === 'string') return { role: 'user', content: prompt };
    return { role: prompt.role, content: prompt.content };
  });
}

/**
 * 读取连接方式展示文本（不含密钥）
 * @param request generateRaw 请求体
 * @param account 本次尝试账号
 * @returns 连接方式文本
 */
function readSnapshotEndpoint(request: TavernHelperGenerateRawConfig, account: PromptLlmAccount | undefined): string {
  const proxyPreset = request.custom_api?.proxy_preset?.trim();
  if (proxyPreset) return `代理预设 ${proxyPreset}`;
  return request.custom_api?.apiurl?.trim() || account?.apiUrl.trim() || '(未配置)';
}

/**
 * 构建监视会话标签：焦点段落摘要
 * @param context Prompt LLM 运行时上下文
 * @returns 标签文本
 */
export function buildLlmInspectorLabel(context: PromptLlmContext): string {
  const summary = context.focusParagraph.replace(/\s+/g, ' ').trim();
  if (!summary) return '段落生图';
  return summary.length > 60 ? `${summary.slice(0, 60)}…` : summary;
}

/** 监视快照的展示信息（不含密钥） */
export interface LlmInspectorRequestDisplay {
  accountName: string;
  /** 连接方式展示（酒馆代理预设名或接口地址） */
  endpoint: string;
  model: string;
}

/**
 * 构建公开接口（小剧场）请求的监视快照
 * 该路径不走 generateRaw，改由酒馆后端直连提交，payload 形状不同，因此单独构造
 * @param id 公开接口本次请求标识
 * @param messages 已组装待发送的指令
 * @param display 账号名、脱敏连接文本与模型
 * @param label 会话标签
 * @returns 可展示的请求快照
 */
export function buildProvidedLlmInspectorSnapshot(
  id: string,
  messages: TavernHelperRolePrompt[],
  display: LlmInspectorRequestDisplay,
  label: string,
): LlmInspectorRequestSnapshot {
  return {
    id,
    label,
    startedAt: Date.now(),
    prompts: readSnapshotPrompts(messages),
    model: display.model || '(未配置)',
    endpoint: display.endpoint,
    accountName: display.accountName,
    // 公开接口固定为非流式单次提交
    streamEnabled: false,
  };
}

/**
 * 构建小剧场监视会话标签：正文摘要
 * @param theaterText 本次小剧场正文
 * @returns 标签文本
 */
export function buildTheaterLlmInspectorLabel(theaterText: string): string {
  const summary = String(theaterText || '').replace(/\s+/g, ' ').trim();
  if (!summary) return '小剧场选景';
  return `小剧场选景：${summary.length > 60 ? `${summary.slice(0, 60)}…` : summary}`;
}
