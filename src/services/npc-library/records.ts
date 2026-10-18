import { normalizeNpcAliases } from '@/constants/npc-library';
import { sanitizeNpcAppearance } from './appearance';

export interface NpcExtractionCandidate {
  name: string;
  aliases: string[];
  appearanceTags: string;
  appearanceNote: string;
}

export const NPC_RECORD_COMMENT_SOURCE = '<!--\\s*cv-npcs\\b([\\s\\S]*?)(?:-->|$)';

/** 正文和生图上下文剥离记录，流式输出的未闭合注释也隐藏。 */
export function stripNpcRecords(text: string): string {
  return text.replace(new RegExp(NPC_RECORD_COMMENT_SOURCE, 'gi'), '');
}

/** 只读取闭合的隐藏记录；损坏或尚未输出完整的记录不入库。 */
export function parseNpcRecords(text: string, excludeNames: string[] = []): NpcExtractionCandidate[] {
  const candidates: NpcExtractionCandidate[] = [];
  for (const match of text.matchAll(/<!--\s*cv-npcs\b([\s\S]*?)-->/gi)) {
    try {
      candidates.push(...normalizeNpcCandidates(JSON.parse(match[1]!.trim()), excludeNames));
    } catch {
      // 格式错误不修改正文，也不发起额外 API 请求。
    }
  }
  return candidates;
}

/** 仅接收模型明确判断为配角的记录；未分类旧记录、路人及不确定人物不自动入库。 */
function normalizeNpcCandidates(value: unknown, excludeNames: string[]): NpcExtractionCandidate[] {
  if (!value || typeof value !== 'object') return [];
  const npcs = (value as { npcs?: unknown }).npcs;
  if (!Array.isArray(npcs)) return [];
  const excluded = new Set(excludeNames.map(name => name.trim().toLowerCase()).filter(Boolean));
  return npcs.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    if (record.role !== 'supporting') return [];
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name || excluded.has(name.toLowerCase())) return [];
    const aliases = Array.isArray(record.aliases)
      ? normalizeNpcAliases(record.aliases.filter((alias): alias is string => typeof alias === 'string'))
      : [];
    if (aliases.some(alias => excluded.has(alias.toLowerCase()))) return [];
    const appearance = sanitizeNpcAppearance(
      typeof record.appearanceTags === 'string' ? record.appearanceTags : '',
      typeof record.appearanceNote === 'string' ? record.appearanceNote : '',
    );
    return [{ name, aliases, appearanceTags: appearance.tags, appearanceNote: appearance.note }];
  });
}
