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

/** 延迟重试窗口（毫秒）：等待 ST 的 loadPersonaForCurrentChat 异步收敛后再补预填用户档案 */
const PREFILL_RECONCILE_DELAY = 500;

/** 事件绑定守卫 */
let prefillBound = false;

/** 延迟重试计时器（每次 CHAT_CHANGED 重置，避免跨聊天串扰） */
let reconcileTimer = 0;

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
    // 角色 key 在 CHAT_CHANGED 时已同步就绪；用户人设 key 依赖 ST 异步加载，
    // 延迟一拍再补一次，等 persona 收敛后补建/修正用户档案，消除"慢半拍"读到上一聊天人设
    window.clearTimeout(reconcileTimer);
    reconcileTimer = window.setTimeout(() => {
      try {
        prefillBlankProfilesForCurrentChat();
      } catch (error) {
        console.debug('[CosmosVision] 人物档案延迟补填失败（已忽略）:', error);
      }
    }, PREFILL_RECONCILE_DELAY);
  });
}

/**
 * 为当前聊天预填空白人物档案（幂等，可纠偏）
 * 角色档案预链角色卡描述条目，用户档案预链 persona 条目；staticTags 留空由用户填写
 * 首次调用创建两份；若首轮因 persona 未收敛而只建了角色档案，后续重试（延迟补填）会补上用户档案
 * @returns 本次新创建/修正的档案列表
 */
export function prefillBlankProfilesForCurrentChat(): PromptPerson[] {
  const profiles = readChatProfiles();
  if (isPrefilled() && profiles.some(person => person.kind === 'user')) return [];

  const created: PromptPerson[] = [];
  const hasCharacter = profiles.some(person => person.kind === 'character');
  const hasUser = profiles.some(person => person.kind === 'user');

  const characterName = getCurrentCharacterKey();
  if (characterName && !hasCharacter) {
    created.push(buildBlankCharacterProfile(characterName));
  }
  const personaKey = getCurrentUserPersonaKey();
  if (personaKey && !hasUser) {
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
  person.templateEntries = buildPrefilledTemplateEntries(
    createPromptPersonCharacterDescriptionEntry(characterName),
  );
  return person;
}

/**
 * 构建预链 persona 的空白用户档案
 */
function buildBlankUserProfile(personaKey: string): PromptPerson {
  const person = createPromptPerson('user', personaKey, [personaKey]);
  person.templateEntries = buildPrefilledTemplateEntries(createPromptPersonUserPersonaEntry(personaKey));
  return person;
}

/**
 * 构建预填档案的模板条目：人物开始 → 资料条目 → 人物结束
 * 保留"人物开始"（含固定 tag 原样复述指令与 <person> 开标签），
 * 使预填档案与手动新建人物结构一致，固定 tag 同样被强调复述
 * @param sourceEntry 预链的资料条目
 * @returns 模板条目数组
 */
function buildPrefilledTemplateEntries(sourceEntry: PromptPerson['templateEntries'][number]): PromptPerson['templateEntries'] {
  const entries = createPromptPerson('character', '__probe__').templateEntries;
  const [startEntry, endEntry] = entries;
  if (!startEntry || !endEntry) return [sourceEntry];
  return [startEntry, sourceEntry, endEntry];
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
