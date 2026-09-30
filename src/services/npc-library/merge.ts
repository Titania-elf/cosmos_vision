import { createNpcLibraryEntry, normalizeNpcAliases, type NpcLibraryEntry } from '@/constants/npc-library';
import type { NpcExtractionCandidate } from '@/services/npc-library/extract';

/** 合并动作类型 */
export type NpcMergeKind = 'create' | 'update' | 'skip-locked' | 'unchanged';

/** 单个 NPC 的合并方案(供确认弹窗展示与应用) */
export interface NpcMergePlan {
  kind: NpcMergeKind;
  name: string;
  group: string;
  /** 命中的已有条目 id(新建时为 null) */
  existingId: string | null;
  existingTags: string;
  /** 合并后的最终 tag(用户可在确认弹窗里再改) */
  mergedTags: string;
  /** 相对已有条目新增的 tag */
  newTags: string[];
  mergedNote: string;
  aliases: string[];
  /** 是否勾选应用(unchanged / skip-locked 默认不勾) */
  accepted: boolean;
}

/**
 * 拆分逗号分隔 tag 串
 * @param tags tag 串
 * @returns 去空白的 tag 数组
 */
function splitTags(tags: string): string[] {
  return tags
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

/**
 * 合并 tag 串:在 base 之上追加 base 中不存在的 extra(大小写不敏感去重)
 * @param base 已有 tag 串
 * @param extra 新 tag 串
 * @returns 合并结果与新增部分
 */
function unionTags(base: string, extra: string): { merged: string; added: string[] } {
  const baseList = splitTags(base);
  const seen = new Set(baseList.map(tag => tag.toLowerCase()));
  const added: string[] = [];
  for (const tag of splitTags(extra)) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(tag);
  }
  return { merged: [...baseList, ...added].join(', '), added };
}

/**
 * 为一批候选生成合并方案
 * @param candidates LLM 抽取候选
 * @param existing 当前全部库条目
 * @param group 目标分组
 * @returns 合并方案列表
 */
export function planNpcMerges(
  candidates: NpcExtractionCandidate[],
  existing: NpcLibraryEntry[],
  group: string,
): NpcMergePlan[] {
  return candidates.map(candidate => planSingleMerge(candidate, existing, group));
}

/**
 * 为单个候选生成合并方案
 * @param candidate LLM 抽取候选
 * @param existing 当前全部库条目
 * @param group 目标分组
 * @returns 合并方案
 */
function planSingleMerge(
  candidate: NpcExtractionCandidate,
  existing: NpcLibraryEntry[],
  group: string,
): NpcMergePlan {
  const match = existing.find(
    entry => entry.group === group && entry.name.trim().toLowerCase() === candidate.name.trim().toLowerCase(),
  );
  if (!match) {
    const tags = unionTags('', candidate.appearanceTags).merged;
    return {
      kind: 'create',
      name: candidate.name,
      group,
      existingId: null,
      existingTags: '',
      mergedTags: tags,
      newTags: splitTags(tags),
      mergedNote: candidate.appearanceNote,
      aliases: candidate.aliases,
      accepted: true,
    };
  }
  const { merged, added } = unionTags(match.staticTags, candidate.appearanceTags);
  const aliases = normalizeNpcAliases([...match.aliases, ...candidate.aliases]);
  const newAliasCount = aliases.length - match.aliases.length;
  const mergedNote = match.appearanceNote.trim() || candidate.appearanceNote;
  const noteChanged = mergedNote !== match.appearanceNote;
  const base = {
    name: match.name,
    group,
    existingId: match.id,
    existingTags: match.staticTags,
    mergedTags: merged,
    newTags: added,
    mergedNote,
    aliases,
  };
  if (match.locked) {
    return { ...base, kind: 'skip-locked', mergedTags: match.staticTags, newTags: [], accepted: false };
  }
  if (!added.length && newAliasCount <= 0 && !noteChanged) {
    return { ...base, kind: 'unchanged', accepted: false };
  }
  return { ...base, kind: 'update', accepted: true };
}

/**
 * 应用合并方案,返回新的全部库条目列表
 * 只处理 accepted 的 create / update；其余保持原样
 * @param plans 合并方案(经用户勾选/编辑)
 * @param existing 当前全部库条目
 * @param sourceNote 来源备注(如"来自聊天扫描")
 * @returns 新的库条目列表
 */
export function applyNpcMergePlans(
  plans: NpcMergePlan[],
  existing: NpcLibraryEntry[],
  sourceNote = '',
): NpcLibraryEntry[] {
  const now = Date.now();
  const result = existing.map(entry => ({ ...entry, aliases: [...entry.aliases] }));
  for (const plan of plans) {
    if (!plan.accepted || plan.kind === 'skip-locked' || plan.kind === 'unchanged') continue;
    if (plan.kind === 'create') {
      const entry = createNpcLibraryEntry(plan.name, plan.group, plan.aliases);
      entry.staticTags = plan.mergedTags;
      entry.appearanceNote = plan.mergedNote;
      entry.sourceNote = sourceNote;
      entry.updatedAt = now;
      result.unshift(entry);
      continue;
    }
    const target = result.find(entry => entry.id === plan.existingId);
    if (!target) continue;
    target.staticTags = plan.mergedTags;
    target.aliases = normalizeNpcAliases(plan.aliases);
    target.appearanceNote = plan.mergedNote;
    target.updatedAt = now;
    if (sourceNote) target.sourceNote = sourceNote;
  }
  return result;
}
