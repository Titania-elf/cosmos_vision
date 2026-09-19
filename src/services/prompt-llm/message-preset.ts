import {
  DEFAULT_PROMPT_LLM_PRESET_ID,
  DEFAULT_PROMPT_LLM_PREVIOUS_SCENES_MESSAGE_ID,
  DEFAULT_PROMPT_LLM_SPECIAL_REQUEST_MESSAGE_ID,
} from '@/constants/default-prompt-llm-preset';
import {
  DEFAULT_PROMPT_LLM_MESSAGE_ENABLED,
  PROMPT_LLM_FOCUS_PARAGRAPH_TOKEN,
  PROMPT_LLM_HISTORY_MESSAGE_ID,
  PROMPT_LLM_HISTORY_MESSAGE_TITLE,
  PROMPT_LLM_HISTORY_TOKEN,
  PROMPT_LLM_PARTICIPANT_MESSAGE_ID,
  PROMPT_LLM_PARTICIPANT_MESSAGE_TITLE,
  PROMPT_LLM_PARTICIPANT_TOKEN,
  PROMPT_LLM_SPECIAL_REQUEST_TOKEN,
} from '@/constants/default-settings';
import type { PromptLlmMessage, PromptLlmMessagePreset, PromptLlmMessagePresetSettings } from '@/constants/prompt-llm';
import { resolvePromptLlmSourceMessage } from '@/services/prompt-llm/message-source';
import { withPromptLlmMessageTriggerDefaults } from '@/services/prompt-llm/message-trigger';
import { PROMPT_LLM_THEATER_TEXT_TOKEN, PROMPT_LLM_PREVIOUS_SCENES_TOKEN } from '@/constants/prompt-llm-tokens';

/** 已下线的小剧场专用预设，旧设置中残留的条目不再保留。 */
const RETIRED_THEATER_PRESET_ID = 'prompt-llm-theater-preset';

/** LLM 运行时替换内容 */
export interface PromptLlmRuntimeContent {
  historyContent: string;
  participantContent: string;
  focusParagraphContent: string;
  specialRequestContent: string;
  theaterTextContent?: string;
  previousScenesContent?: string;
}

/** 旧版运行时保留条目迁移配置 */
interface LegacyRuntimeMessageConfig {
  id: string;
  title: string;
  token: string;
}

const LEGACY_RUNTIME_MESSAGE_CONFIGS = [
  { id: PROMPT_LLM_HISTORY_MESSAGE_ID, title: PROMPT_LLM_HISTORY_MESSAGE_TITLE, token: PROMPT_LLM_HISTORY_TOKEN },
  { id: PROMPT_LLM_PARTICIPANT_MESSAGE_ID, title: PROMPT_LLM_PARTICIPANT_MESSAGE_TITLE, token: PROMPT_LLM_PARTICIPANT_TOKEN },
] as const satisfies readonly LegacyRuntimeMessageConfig[];

const PROMPT_LLM_CONTENT_TOKEN_PATTERN = /\{\{(?:history|participants|focus_paragraph|special_request|theater_text|previous_scenes)\}\}/g;

/**
 * 解析预设是否需要附加原始素材兜底 user 消息
 * 显式设置优先；未设置时内置默认预设关（自带宏），其余预设开（省去手写宏）。
 * @param preset 消息预设
 * @returns 是否附加原始素材兜底消息
 */
export function resolvePresetAppendProvidedContext(
  preset: Pick<PromptLlmMessagePreset, 'id' | 'appendProvidedContext'>,
): boolean {
  if (typeof preset.appendProvidedContext === 'boolean') return preset.appendProvidedContext;
  return preset.id !== DEFAULT_PROMPT_LLM_PRESET_ID;
}

/**
 * 读取当前激活的提示词预设
 * @param presetSettings 消息预设集合
 * @returns 激活预设
 */
export function getActivePromptLlmPreset(presetSettings: PromptLlmMessagePresetSettings): PromptLlmMessagePreset {
  const preset = presetSettings.presets.find(item => item.id === presetSettings.activePresetId) ?? presetSettings.presets[0];
  if (!preset) throw new Error('未找到当前激活的提示词预设');
  return preset;
}

/**
 * 规范化 LLM 消息预设并清理已下线的小剧场预设
 * @param presetSettings 预设集合
 * @returns 已规范化的预设集合
 */
export function normalizePromptLlmMessagePresets(
  presetSettings: PromptLlmMessagePresetSettings,
): PromptLlmMessagePresetSettings {
  const presets = presetSettings.presets
    .filter(preset => preset.id !== RETIRED_THEATER_PRESET_ID)
    .map(normalizePromptLlmPreset);
  // 小剧场改用内置预设；旧设置若正指向已下线预设，回落到默认预设。
  const activePresetId =
    presetSettings.activePresetId === RETIRED_THEATER_PRESET_ID
      ? DEFAULT_PROMPT_LLM_PRESET_ID
      : presetSettings.activePresetId;
  return { ...presetSettings, activePresetId, presets };
}

/**
 * 构建条目运行时文本
 * @param message 消息条目
 * @param runtimeContent 运行时内容
 * @returns 实际发送文本
 */
export async function resolvePromptLlmMessageContent(
  message: Pick<PromptLlmMessage, 'title' | 'content' | 'reference' | 'id'>,
  runtimeContent: PromptLlmRuntimeContent,
): Promise<string> {
  const sourceMessage = await resolvePromptLlmSourceMessage(message);
  const content = sourceMessage ? readPromptLlmSourceText(sourceMessage) : message.content;
  return replacePromptLlmContentTokens(content, runtimeContent);
}

/**
 * 替换自定义消息中的动态宏
 * @param content 原始消息内容
 * @param runtimeContent 运行时内容
 * @returns 宏替换后的消息内容
 */
export function replacePromptLlmContentTokens(content: string, runtimeContent: PromptLlmRuntimeContent): string {
  const replacements: Record<string, string> = {
    [PROMPT_LLM_HISTORY_TOKEN]: runtimeContent.historyContent,
    [PROMPT_LLM_PARTICIPANT_TOKEN]: runtimeContent.participantContent,
    [PROMPT_LLM_FOCUS_PARAGRAPH_TOKEN]: runtimeContent.focusParagraphContent,
    [PROMPT_LLM_SPECIAL_REQUEST_TOKEN]: runtimeContent.specialRequestContent,
    [PROMPT_LLM_THEATER_TEXT_TOKEN]: runtimeContent.theaterTextContent ?? '',
    [PROMPT_LLM_PREVIOUS_SCENES_TOKEN]: runtimeContent.previousScenesContent ?? '',
  };
  return content.replace(PROMPT_LLM_CONTENT_TOKEN_PATTERN, token => replacements[token] ?? token);
}

/**
 * 读取来源条目的可发送文本
 * @param sourceMessage 来源条目解析结果
 * @returns 可发送内容
 */
function readPromptLlmSourceText(sourceMessage: Awaited<ReturnType<typeof resolvePromptLlmSourceMessage>>): string {
  if (!sourceMessage || sourceMessage.status !== 'ready') return '';
  return sourceMessage.content;
}

/**
 * 规范化单个预设
 * @param preset 原始消息预设
 * @returns 已规范化消息预设
 */
function normalizePromptLlmPreset(preset: PromptLlmMessagePreset): PromptLlmMessagePreset {
  const messages = preset.messages.map(normalizePromptLlmMessage);
  const withDefaults = ensureDefaultPreviousScenesMessage(
    preset.id,
    ensureDefaultSpecialRequestMessage(preset.id, messages),
  );
  // 内置默认预设固定关闭原始素材兜底（自带宏，避免重复注入）；旧设置里残留的显式值一并归位。
  const appendProvidedContext =
    preset.id === DEFAULT_PROMPT_LLM_PRESET_ID ? false : preset.appendProvidedContext;
  return { ...preset, appendProvidedContext, messages: withDefaults };
}

/**
 * 为默认内置预设补齐本次特别要求消息
 * @param presetId 预设 ID
 * @param messages 当前消息列表
 * @returns 补齐后的消息列表
 */
function ensureDefaultSpecialRequestMessage(presetId: string, messages: PromptLlmMessage[]): PromptLlmMessage[] {
  if (presetId !== DEFAULT_PROMPT_LLM_PRESET_ID) return messages;
  if (messages.some(message => message.id === DEFAULT_PROMPT_LLM_SPECIAL_REQUEST_MESSAGE_ID)) return messages;
  return [...messages, createSpecialRequestMessage()];
}

/**
 * 为默认内置预设补齐既往画面消息
 * 关闭原始素材兜底后，靠该条目通过 {{previous_scenes}} 宏保留避免重复选景的参考。
 * @param presetId 预设 ID
 * @param messages 当前消息列表
 * @returns 补齐后的消息列表
 */
function ensureDefaultPreviousScenesMessage(presetId: string, messages: PromptLlmMessage[]): PromptLlmMessage[] {
  if (presetId !== DEFAULT_PROMPT_LLM_PRESET_ID) return messages;
  if (messages.some(message => message.id === DEFAULT_PROMPT_LLM_PREVIOUS_SCENES_MESSAGE_ID)) return messages;
  return [...messages, createPreviousScenesMessage()];
}

/**
 * 规范化单条消息
 * @param message 原始消息
 * @returns 带默认字段与迁移内容的消息
 */
function normalizePromptLlmMessage(message: PromptLlmMessage): PromptLlmMessage {
  return migrateLegacyRuntimeMessage(withPromptLlmMessageTriggerDefaults({ ...message }));
}

/**
 * 迁移旧版运行时保留消息为普通宏条目
 * @param message 原始消息
 * @returns 迁移后的普通消息
 */
function migrateLegacyRuntimeMessage(message: PromptLlmMessage): PromptLlmMessage {
  const config = LEGACY_RUNTIME_MESSAGE_CONFIGS.find(item => item.id === message.id);
  if (!config) return message;
  return { ...message, title: message.title.trim() || config.title, content: config.token };
}

/**
 * 创建默认预设中的本次特别要求消息
 * @returns 特别要求消息条目
 */
function createSpecialRequestMessage(): PromptLlmMessage {
  return withPromptLlmMessageTriggerDefaults({
    id: DEFAULT_PROMPT_LLM_SPECIAL_REQUEST_MESSAGE_ID,
    title: '本次临时追加要求',
    role: 'user',
    content: ['', '<special_request>', `    ${PROMPT_LLM_SPECIAL_REQUEST_TOKEN}`, '</special_request>', ''].join('\n'),
    enabled: DEFAULT_PROMPT_LLM_MESSAGE_ENABLED,
  });
}

/**
 * 创建默认预设中的既往画面消息
 * @returns 既往画面消息条目
 */
function createPreviousScenesMessage(): PromptLlmMessage {
  return withPromptLlmMessageTriggerDefaults({
    id: DEFAULT_PROMPT_LLM_PREVIOUS_SCENES_MESSAGE_ID,
    title: '既往画面',
    role: 'system',
    content: [
      '<previous_scenes>',
      '    以下是本篇正文此前已经选过的画面（JSON 数组，可能为空 []）。请避免重复选择同一画面，尽量选取新的时空或视角：',
      PROMPT_LLM_PREVIOUS_SCENES_TOKEN,
      '</previous_scenes>',
      '',
    ].join('\n'),
    enabled: DEFAULT_PROMPT_LLM_MESSAGE_ENABLED,
  });
}
