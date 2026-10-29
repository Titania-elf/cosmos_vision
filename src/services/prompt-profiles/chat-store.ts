import { chat_metadata, saveChatDebounced } from '@sillytavern/script';

import type { PromptPerson, PromptPersonSourceReference, PromptProfilesSettings } from '@/constants/prompt-llm';
import { uuidv4 } from '@sillytavern/scripts/utils';

/** chat_metadata 中本插件人物档案的命名空间 key */
const PROFILES_METADATA_KEY = 'cosmos_vision_profiles';

/** 当前聊天人物档案持久化后通知 UI 刷新。 */
export const CHAT_PROFILES_CHANGED = 'cosmos-vision:chat-profiles-changed';

/**
 * 读取当前聊天的人物档案列表
 * 返回规范化后的独立副本：修改后调用 persistChatProfiles 落盘
 * 无档案或数据异常时返回空数组（静默降级）
 */
export function readChatProfiles(): PromptPerson[] {
  return readProfilesFromMetadata(chat_metadata);
}

/** 从任意聊天 metadata 读取并规范化人物档案，不修改传入数据。 */
export function readProfilesFromMetadata(metadata: unknown): PromptPerson[] {
  const raw = readRawProfilesMetadata(metadata);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(normalizeChatProfile);
}

/**
 * 把人物档案列表写回 chat metadata 并触发聊天落盘
 */
export function persistChatProfiles(profiles: PromptPerson[]): void {
  (chat_metadata as Record<string, unknown>)[PROFILES_METADATA_KEY] = profiles;
  saveChatDebounced();
  window.dispatchEvent(new Event(CHAT_PROFILES_CHANGED));
}

/**
 * 当前聊天是否已建立任何启用中的人物档案（提醒判定用）
 */
export function hasActiveChatProfiles(): boolean {
  return readChatProfiles().some(person => person.enabled !== false);
}

/**
 * 读取全局旧版档案（废弃路线：仅用于展示迁移提示，不再参与运行时）
 */
export function readLegacyGlobalProfiles(settings: PromptProfilesSettings): PromptPerson[] {
  return settings.profiles.flatMap(normalizeChatProfile);
}

/**
 * 把全局旧档案复制进当前聊天（一次性迁移入口，可选使用）
 */
export function importLegacyGlobalProfiles(settings: PromptProfilesSettings): PromptPerson[] {
  const legacy = readLegacyGlobalProfiles(settings);
  if (!legacy.length) return [];
  const existing = readChatProfiles();
  const existingNames = new Set(existing.map(person => person.name));
  const imported = legacy
    .filter(person => !existingNames.has(person.name))
    .map(person => ({ ...person, id: uuidv4() }));
  persistChatProfiles([...existing, ...imported]);
  return imported;
}

/**
 * 从 chat_metadata 读取原始档案数组
 */
function readRawProfilesMetadata(metadata: unknown): unknown {
  try {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = (metadata as Record<string, unknown>)[PROFILES_METADATA_KEY];
    return Array.isArray(value) ? value : null;
  } catch (error) {
    console.debug('[CosmosVision] 读取人物档案 metadata 失败:', error);
    return null;
  }
}

/**
 * 规范化单条人物档案（坏条目丢弃）
 */
function normalizeChatProfile(value: unknown): PromptPerson[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const kind = record.kind === 'user' || record.kind === 'character' ? record.kind : null;
  if (!kind) return [];
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return [];
  const insertMode = record.insertMode === 'always' || record.insertMode === 'keyword' ? record.insertMode : 'keyword';
  return [
    {
      id: typeof record.id === 'string' && record.id.trim() ? record.id : uuidv4(),
      name,
      kind,
      enabled: record.enabled !== false,
      insertMode,
      triggerKeywords: Array.isArray(record.triggerKeywords)
        ? Array.from(new Set(record.triggerKeywords.filter((keyword): keyword is string => typeof keyword === 'string' && Boolean(keyword.trim()))))
        : [],
      staticTags: typeof record.staticTags === 'string' ? record.staticTags : '',
      templateEntries: Array.isArray(record.templateEntries)
        ? record.templateEntries.flatMap(normalizeTemplateEntry)
        : [],
    },
  ];
}

/**
 * 规范化单条模板条目（坏条目丢弃）
 */
function normalizeTemplateEntry(value: unknown): PromptPerson['templateEntries'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return [];
  return [
    {
      id: typeof record.id === 'string' && record.id.trim() ? record.id : uuidv4(),
      title,
      enabled: record.enabled !== false,
      content: typeof record.content === 'string' ? record.content : '',
      reference: normalizeReference(record.reference),
    },
  ];
}

/** 仅复制引用中类型合法的已知字段，避免保留未知字段或共享嵌套对象。 */
function normalizeReference(value: unknown): PromptPersonSourceReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const reference: PromptPersonSourceReference = {};
  for (const key of ['worldbookName', 'characterName', 'personaId', 'personaName'] as const) {
    const field = record[key];
    if (typeof field === 'string') reference[key] = field;
  }
  if (typeof record.entryUid === 'number' && Number.isFinite(record.entryUid)) {
    reference.entryUid = record.entryUid;
  }
  return Object.keys(reference).length ? reference : undefined;
}
