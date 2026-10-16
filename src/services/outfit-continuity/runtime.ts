import {
  chat,
  chat_metadata,
  event_types,
  eventSource,
  getCurrentChatId,
  saveChatDebounced,
  setExtensionPrompt,
  extension_prompt_types,
  extension_prompt_roles,
} from '@sillytavern/script';
import {
  DEFAULT_OUTFIT_CONTINUITY_PROMPT,
  type OutfitContinuitySettings,
  type OutfitUpdate,
} from '@/constants/outfit-continuity';
import type { PromptLlmContext } from '@/constants/prompt-llm';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { appendOutfitUpdate, formatOutfitContext, resolveOutfitRecords } from './timeline';

const METADATA_KEY = 'cosmos_vision_outfit_continuity';
const PROMPT_KEY = 'cosmos_vision_outfit_continuity';
export const OUTFIT_CONTINUITY_CHANGED = 'cosmos-vision:outfits-changed';
let bound = false;
let generationType = '';
let generationMaxIndex: number | undefined;

/** 使用酒馆显示/prompt 正则隐藏注释；不在原始消息上运行，保留每个 swipe 的记录。 */
export function installOutfitHiddenRegex(): void {
  const id = 'cosmos-vision-outfits-hidden';
  const scripts = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
  const script = {
    id,
    scriptName: 'Cosmos Vision · 隐藏服装记录',
    findRegex: '/<!--\\s*cv-outfits\\b[\\s\\S]*?(?:-->|$)/gi',
    replaceString: '',
    trimStrings: [],
    placement: [2],
    disabled: false,
    markdownOnly: true,
    promptOnly: true,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: -1,
    maxDepth: -1,
  };
  extension_settings.regex = [...scripts.filter(item => item.id !== id), script];
}

export function readOutfitContinuitySettings(): OutfitContinuitySettings {
  const value = (chat_metadata as Record<string, unknown>)[METADATA_KEY];
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    enabled: raw.enabled === true,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : DEFAULT_OUTFIT_CONTINUITY_PROMPT,
  };
}

export function saveOutfitContinuitySettings(settings: OutfitContinuitySettings): void {
  if (!getCurrentChatId()) throw new Error('请先打开一个聊天');
  (chat_metadata as Record<string, unknown>)[METADATA_KEY] = { ...settings };
  saveChatDebounced();
  refreshOutfitPrompt();
}

export function readCurrentOutfitRecords() {
  return resolveOutfitRecords(chat, { messageIndex: chat.length - 1 });
}

/** 没有楼层定位的手动/外部请求不读取最新穿着，避免污染旧剧情。 */
export function buildImageOutfitContext(context: PromptLlmContext): string {
  if (context.messageIndex == null || !Number.isInteger(context.messageIndex) || context.messageIndex < 0) return '';
  if (context.messageIndex >= chat.length) return '';
  return formatOutfitContext(
    resolveOutfitRecords(chat, {
      messageIndex: context.messageIndex,
      paragraphIndex: context.paragraphIndex,
      focusMessageText: context.focusMessageText,
    }),
    'image',
  );
}

/** 手动记录写回选中消息及当前 swipe，保留其他生图短码和记录。 */
export function saveManualOutfitUpdate(messageIndex: number, update: OutfitUpdate): void {
  if (!getCurrentChatId()) throw new Error('请先打开一个聊天');
  const message = chat[messageIndex];
  if (!Number.isInteger(messageIndex) || !message || message.is_user || message.is_system) {
    throw new Error('请选择有效的 AI 消息楼层');
  }
  if (
    !update.name.trim() ||
    !update.outfit.trim() ||
    !Number.isInteger(update.fromParagraph) ||
    update.fromParagraph < 1
  ) {
    throw new Error('请填写人物姓名、完整穿着及有效的起始段落');
  }
  message.mes = appendOutfitUpdate(message.mes, { ...update, name: update.name.trim(), outfit: update.outfit.trim() });
  if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number') {
    message.swipes[message.swipe_id] = message.mes;
  }
  saveChatDebounced();
  refreshOutfitPrompt();
}

export function refreshOutfitPrompt(): void {
  const settings = readOutfitContinuitySettings();
  const messageIndex = Math.min(chat.length - 1, generationMaxIndex ?? chat.length - 1);
  const state = formatOutfitContext(resolveOutfitRecords(chat, { messageIndex }), 'story');
  const value =
    getCurrentChatId() &&
    settings.enabled &&
    settings.prompt.trim() &&
    generationType !== 'quiet' &&
    generationType !== 'impersonate'
      ? [settings.prompt.trim(), state].filter(Boolean).join('\n\n')
      : '';
  setExtensionPrompt(PROMPT_KEY, value, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
  window.dispatchEvent(new Event(OUTFIT_CONTINUITY_CHANGED));
}

export function startOutfitContinuity(): void {
  if (bound) return;
  bound = true;
  installOutfitHiddenRegex();
  const events = [
    'CHAT_CHANGED',
    'MESSAGE_RECEIVED',
    'MESSAGE_UPDATED',
    'MESSAGE_SWIPED',
    'MESSAGE_DELETED',
    'CHARACTER_MESSAGE_RENDERED',
  ] as const;
  for (const key of events) {
    eventSource.on(event_types[key], () => {
      if (key === 'CHAT_CHANGED') {
        generationType = '';
        generationMaxIndex = undefined;
      }
      refreshOutfitPrompt();
    });
  }
  eventSource.on(event_types.GENERATION_AFTER_COMMANDS, (type: unknown) => {
    generationType = typeof type === 'string' ? type : '';
    const replacing = generationType === 'swipe' || generationType === 'regenerate';
    generationMaxIndex = replacing && chat.at(-1) && !chat.at(-1)?.is_user ? chat.length - 2 : undefined;
    refreshOutfitPrompt();
  });
  eventSource.on(event_types.GENERATION_ENDED, () => {
    generationType = '';
    generationMaxIndex = undefined;
    refreshOutfitPrompt();
  });
  eventSource.on(event_types.GENERATION_STOPPED, () => {
    generationType = '';
    generationMaxIndex = undefined;
    refreshOutfitPrompt();
  });
  refreshOutfitPrompt();
}
