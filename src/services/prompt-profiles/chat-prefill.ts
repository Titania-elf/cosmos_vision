import { chat_metadata, event_types, eventSource, saveChatDebounced } from '@sillytavern/script';

import type { PromptPerson } from '@/constants/novelai';
import { createPromptPerson } from '@/services/prompt-profiles/runtime';
import { persistChatProfiles, readChatProfiles } from '@/services/prompt-profiles/chat-store';
import { getCurrentCharacterKey, getCurrentUserPersonaKey } from '@/services/tavern-helper/prompt-profiles-context';
import {
  createPromptPersonCharacterDescriptionEntry,
  createPromptPersonUserPersonaEntry,
} from '@/services/tavern-helper/prompt-profiles-sources';

/** 预填开关的 chat_metadata key（独立于档案数据，按聊天记忆用户选择） */
const PREFILL_FLAG_METADATA_KEY = 'cosmos_vision_profiles_prefilled';

/** 事件绑定守卫 */
let prefillBound = false;

/**
 * 绑定新聊天预填监听（插件入口调用一次）
 * 切换/新建聊天时若本聊天无档案且未预填过，自动创建空白档案
 * 完全静默：不弹窗、不阻塞
 */
export function bindChatProfilesPrefill(): void {
  if (prefillBound) return;
  prefillBound = true;
  eventSource.on(event_types.CHAT_CHANGED, () => {
    try {
      prefillBlankProfilesForCurrentChat();
    } catch (error) {
      console.debug('[CosmosVision] 人物档案预填失败（已忽略）:', error);
    }
  });
}

/**
 * 为当前聊天预填空白人物档案（幂等）
 * 角色档案预链角色卡描述条目，用户档案预链 persona 条目；staticTags 留空由用户填写
 * 已有档案或已预填过的聊天不再处理
 * @returns 本次新创建的档案列表
 */
export function prefillBlankProfilesForCurrentChat(): PromptPerson[] {
  const profiles = readChatProfiles();
  if (profiles.length > 0) return [];
  if (isPrefilled()) return [];

  const created: PromptPerson[] = [];
  const characterName = getCurrentCharacterKey();
  if (characterName) {
    created.push(buildBlankCharacterProfile(characterName));
  }
  const personaKey = getCurrentUserPersonaKey();
  if (personaKey) {
    created.push(buildBlankUserProfile(personaKey));
  }

  if (!created.length) {
    // 无法识别角色与用户（如群聊/临时聊天）：标记已预填，避免每次事件重试
    markPrefilled();
    return [];
  }

  persistChatProfiles([...profiles, ...created]);
  markPrefilled();
  return created;
}

/**
 * 构建预链角色卡描述的空白角色档案
 */
function buildBlankCharacterProfile(characterName: string): PromptPerson {
  const person = createPromptPerson('character', characterName, [characterName]);
  person.templateEntries = [
    createPromptPersonCharacterDescriptionEntry(characterName),
    ...createDefaultPromptPersonTemplateEntriesTail(),
  ];
  return person;
}

/**
 * 构建预链 persona 的空白用户档案
 */
function buildBlankUserProfile(personaKey: string): PromptPerson {
  const person = createPromptPerson('user', personaKey, [personaKey]);
  person.templateEntries = [
    createPromptPersonUserPersonaEntry(personaKey),
    ...createDefaultPromptPersonTemplateEntriesTail(),
  ];
  return person;
}

/**
 * 读取默认人物开始/结束条目之外的尾部条目（保持既有默认结构）
 */
function createDefaultPromptPersonTemplateEntriesTail(): PromptPerson['templateEntries'] {
  const entries = createPromptPerson('character', '__probe__').templateEntries;
  return entries.slice(1);
}

/**
 * 读取预填标记
 */
function isPrefilled(): boolean {
  const value = (chat_metadata as Record<string, unknown>)[PREFILL_FLAG_METADATA_KEY];
  return value === true;
}

/**
 * 写入预填标记（触发聊天落盘）
 */
function markPrefilled(): void {
  (chat_metadata as Record<string, unknown>)[PREFILL_FLAG_METADATA_KEY] = true;
  saveChatDebounced();
}
