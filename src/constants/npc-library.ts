import { uuidv4 } from '@sillytavern/scripts/utils';

import type { PromptPersonInsertMode } from '@/constants/prompt-llm';

/**
 * NPC 外观维护库常量与类型
 * 库是跨聊天的全局外观真源,按故事(角色卡)分组,生图时按关键词命中注入 participants
 */

/** 通用分组:在所有故事里都可能被注入的 NPC */
export const NPC_LIBRARY_GLOBAL_GROUP = '__global__';

/** 通用分组的展示名 */
export const NPC_LIBRARY_GLOBAL_GROUP_LABEL = '通用';

/** 手动扫描当前聊天时向前追溯的楼层数 */
export const NPC_SCAN_FLOOR_COUNT = 30;

/** 后台自动更新时,以触发消息结尾向前追溯的楼层数(含该楼) */
export const NPC_AUTO_SCAN_FLOOR_COUNT = 2;

/** NPC 库条目 */
export interface NpcLibraryEntry {
  id: string;
  /** NPC 名(展示 + 同名去重键) */
  name: string;
  /** 所属分组:当前角色卡 key,或 NPC_LIBRARY_GLOBAL_GROUP 表示通用 */
  group: string;
  /** 别名/触发关键词(name 会隐式并入触发词) */
  aliases: string[];
  enabled: boolean;
  /** 锁定后不被半自动/全自动更新覆盖(留给后续阶段) */
  locked: boolean;
  /** 触发模式:always 始终注入,keyword 命中关键词才注入 */
  insertMode: PromptPersonInsertMode;
  /** 长期外观锚点的 danbooru tag 串(逗号分隔纯文本) */
  staticTags: string;
  /** 自由文本外观补充(可选,给 LLM 参考) */
  appearanceNote: string;
  /** 最近更新时间戳(毫秒) */
  updatedAt: number;
  /** 来源备注(可选,后续自动抽取时填) */
  sourceNote: string;
}

/** NPC 库设置集合 */
export interface NpcLibrarySettings {
  entries: NpcLibraryEntry[];
}

/**
 * 创建空的 NPC 库设置
 * @returns 空库
 */
export function createNpcLibrarySettings(): NpcLibrarySettings {
  return { entries: [] };
}

/**
 * 创建 NPC 库条目
 * @param name NPC 名
 * @param group 所属分组
 * @param aliases 触发别名
 * @returns 新的库条目
 */
export function createNpcLibraryEntry(
  name: string,
  group: string,
  aliases: string[] = [],
): NpcLibraryEntry {
  const trimmedName = name.trim() || '未命名 NPC';
  return {
    id: uuidv4(),
    name: trimmedName,
    group: group.trim() || NPC_LIBRARY_GLOBAL_GROUP,
    aliases: normalizeNpcAliases(aliases),
    enabled: true,
    locked: false,
    insertMode: 'keyword',
    staticTags: '',
    appearanceNote: '',
    updatedAt: Date.now(),
    sourceNote: '',
  };
}

/**
 * 标准化 NPC 别名数组(去空白去重)
 * @param aliases 原始别名列表
 * @returns 去重后的别名
 */
export function normalizeNpcAliases(aliases: string[]): string[] {
  return Array.from(new Set(aliases.map(alias => alias.trim()).filter(Boolean)));
}

/**
 * 读取分组展示名
 * @param group 分组 key
 * @returns 展示名(通用组转中文标签,其余原样)
 */
export function getNpcGroupLabel(group: string): string {
  return group === NPC_LIBRARY_GLOBAL_GROUP ? NPC_LIBRARY_GLOBAL_GROUP_LABEL : group;
}
