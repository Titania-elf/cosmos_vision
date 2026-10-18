import {
  createNpcLibraryEntry,
  normalizeNpcAliases,
  NPC_LIBRARY_GLOBAL_GROUP,
  type NpcLibraryEntry,
} from '@/constants/npc-library';
import type { NpcExtractionCandidate } from './records';

export const NPC_AUTO_CREATE_SOURCE = '首次出场自动建档';

/** 只有自动建立且尚无外观的姓名档案允许自动补全。 */
export function canFillNpcAppearance(entry: NpcLibraryEntry): boolean {
  return (
    !entry.locked &&
    entry.enabled &&
    entry.sourceNote === NPC_AUTO_CREATE_SOURCE &&
    !entry.staticTags.trim() &&
    !entry.appearanceNote.trim()
  );
}

/** 姓名与别名共同构成身份键，避免后续用另一个称呼重复建档。 */
export function npcIdentityNames(person: { name: string; aliases: string[] }): string[] {
  return [...new Set([person.name, ...person.aliases].map(name => name.trim().toLowerCase()).filter(Boolean))];
}

/** 自动建档只创建新人物、补全自动姓名档案；完整档案由用户维护。 */
export function applyNpcFirstAppearances(
  candidates: NpcExtractionCandidate[],
  existing: NpcLibraryEntry[],
  group: string,
): NpcLibraryEntry[] {
  let result = existing;
  for (const candidate of candidates) {
    const names = new Set(npcIdentityNames(candidate));
    const match = result.find(
      entry =>
        (entry.group === group || entry.group === NPC_LIBRARY_GLOBAL_GROUP) &&
        npcIdentityNames(entry).some(name => names.has(name)),
    );
    if (match) {
      if (
        match.group !== group ||
        !canFillNpcAppearance(match) ||
        (!candidate.appearanceTags && !candidate.appearanceNote)
      )
        continue;
      result = result.map(entry =>
        entry !== match
          ? entry
          : {
              ...entry,
              aliases: normalizeNpcAliases([...entry.aliases, candidate.name, ...candidate.aliases]),
              staticTags: candidate.appearanceTags,
              appearanceNote: candidate.appearanceNote,
              updatedAt: Date.now(),
            },
      );
    } else {
      const entry = createNpcLibraryEntry(candidate.name, group, candidate.aliases);
      entry.staticTags = candidate.appearanceTags;
      entry.appearanceNote = candidate.appearanceNote;
      entry.sourceNote = NPC_AUTO_CREATE_SOURCE;
      result = [...result, entry];
    }
  }
  return result;
}
