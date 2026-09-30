import { extension_settings } from '@sillytavern/scripts/extensions';

import {
  NPC_LIBRARY_GLOBAL_GROUP,
  normalizeNpcAliases,
  type NpcLibraryEntry,
} from '@/constants/npc-library';

/** ST extension_settings 中本扩展的 key(与 store/settings.ts 保持一致) */
const SETTINGS_KEY = 'cosmos_vision';

/**
 * 读取全局 NPC 库条目列表
 * 直接读 extension_settings(库通过 store 即时落盘,这里读到的始终是最新持久化值)
 * 数据异常时静默降级为空数组
 * @returns 已清洗的 NPC 库条目
 */
export function readNpcLibraryEntries(): NpcLibraryEntry[] {
  const raw = readRawNpcLibraryEntries();
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(normalizeNpcLibraryEntry);
}

/**
 * 从 extension_settings 读取原始 NPC 库条目数组
 * @returns 原始数组或 null
 */
function readRawNpcLibraryEntries(): unknown {
  try {
    const settings = (extension_settings as Record<string, unknown>)[SETTINGS_KEY];
    if (!settings || typeof settings !== 'object') return null;
    const library = (settings as Record<string, unknown>).npcLibrary;
    if (!library || typeof library !== 'object') return null;
    const entries = (library as Record<string, unknown>).entries;
    return Array.isArray(entries) ? entries : null;
  } catch (error) {
    console.debug('[CosmosVision] 读取 NPC 库 metadata 失败:', error);
    return null;
  }
}

/**
 * 规范化单条 NPC 库条目(坏条目丢弃)
 * @param value 原始条目
 * @returns 规范化后的单元素数组或空数组
 */
function normalizeNpcLibraryEntry(value: unknown): NpcLibraryEntry[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name) return [];
  const insertMode = record.insertMode === 'always' || record.insertMode === 'keyword' ? record.insertMode : 'keyword';
  return [
    {
      id: typeof record.id === 'string' && record.id.trim() ? record.id : name,
      name,
      group: typeof record.group === 'string' && record.group.trim() ? record.group : NPC_LIBRARY_GLOBAL_GROUP,
      aliases: Array.isArray(record.aliases)
        ? normalizeNpcAliases(record.aliases.filter((alias): alias is string => typeof alias === 'string'))
        : [],
      enabled: record.enabled !== false,
      locked: record.locked === true,
      insertMode,
      staticTags: typeof record.staticTags === 'string' ? record.staticTags : '',
      appearanceNote: typeof record.appearanceNote === 'string' ? record.appearanceNote : '',
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
      sourceNote: typeof record.sourceNote === 'string' ? record.sourceNote : '',
    },
  ];
}
