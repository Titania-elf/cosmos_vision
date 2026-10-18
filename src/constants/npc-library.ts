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

/** 自动建档的配角判断，避免把具名路人入库。 */
export const NPC_SUPPORTING_ROLE_RULES = `先判断人物是否为配角，再提取外观。有姓名、外貌描写、单次台词或多次被提及，都不等于配角。
配角须在正文或人物资料中有明确依据：具有持续的人物关系（如同伴、家人、朋友、对手），或作为独立人物承担明确的剧情作用、实质参与主要互动。不能只凭姓名、职业或外貌推测其后续重要性。
仅负责临时问路、结账、服务、传话或充当背景的一次性人物，即使有姓名和外貌，也归为 incidental；泛称路人、只被提到/回忆/设想的人物以及主角、用户本人不建档。
首次出场已明确是配角即可建档，无须等第二次出现；证据不足时归为 uncertain，先跳过，后续剧情明确其配角身份后再建档。重复出现本身不能作为升级为配角的理由。
role 只允许 supporting（明确配角）、incidental（路人/临时人物）、uncertain（尚不确定）。仅输出 role 为 supporting 的人物；不能为了建档而把所有有名字的人都标为 supporting。`;

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
  /** 锁定后不被自动补全覆盖 */
  locked: boolean;
  /** 触发模式:always 始终注入,keyword 命中关键词才注入 */
  insertMode: PromptPersonInsertMode;
  /** 身体外观锚点的 danbooru tag 串，不含服装和配饰(逗号分隔纯文本) */
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
export function createNpcLibraryEntry(name: string, group: string, aliases: string[] = []): NpcLibraryEntry {
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
