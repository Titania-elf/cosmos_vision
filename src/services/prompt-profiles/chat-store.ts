import { chat_metadata, saveChatDebounced } from '@sillytavern/script';

import type { PromptPerson, PromptProfilesSettings } from '@/constants/novelai';
import { uuidv4 } from '@sillytavern/scripts/utils';

/** chat_metadata 中本插件人物档案的命名空间 key */
const PROFILES_METADATA_KEY = 'cosmos_vision_profiles';

/**
 * 读取当前聊天的人物档案列表
 * 返回的是 chat_metadata 内的实时对象引用：修改后调用 persistChatProfiles 落盘
 * 无档案或数据异常时返回空数组（静默降级）
 */
export function readChatProfiles(): PromptPerson[] {
  const raw = readRawProfilesMetadata();
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(normalizeChatProfile);
}

/**
 * 把人物档案列表写回 chat metadata 并触发聊天落盘
 */
export function persistChatProfiles(profiles: PromptPerson[]): void {
  (chat_metadata as Record<string, unknown>)[PROFILES_METADATA_KEY] = profiles;
  saveChatDebounced();
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
function readRawProfilesMetadata(): unknown {
  try {
    const value = (chat_metadata as Record<string, unknown>)[PROFILES_METADATA_KEY];
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
  if (!value || typeof value !== 'object') return [];
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
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!title) return [];
  return [
    {
      id: typeof record.id === 'string' && record.id.trim() ? record.id : uuidv4(),
      title,
      enabled: record.enabled !== false,
      content: typeof record.content === 'string' ? record.content : '',
      reference: isReference(record.reference) ? record.reference : undefined,
    },
  ];
}

/**
 * 判断引用对象结构合法
 */
function isReference(value: unknown): value is PromptPerson['templateEntries'][number]['reference'] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['worldbookName', 'characterName', 'personaId', 'personaName', 'entryUid'].some(key => key in record);
}
