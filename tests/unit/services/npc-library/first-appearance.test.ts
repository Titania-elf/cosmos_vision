import { describe, expect, it } from 'vitest';
import { createNpcLibraryEntry, NPC_LIBRARY_GLOBAL_GROUP } from '@/constants/npc-library';
import { applyNpcFirstAppearances, NPC_AUTO_CREATE_SOURCE } from '@/services/npc-library/first-appearance';
import type { NpcExtractionCandidate } from '@/services/npc-library/records';

function candidate(patch: Partial<NpcExtractionCandidate> = {}): NpcExtractionCandidate {
  return { name: 'Aiko', aliases: ['小爱'], appearanceTags: 'blue hair', appearanceNote: '', ...patch };
}

describe('首次出场建档', () => {
  it('先创建姓名档案，后续补全一次外观，之后不追加矛盾描述', () => {
    const first = applyNpcFirstAppearances([candidate({ appearanceTags: '' })], [], 'Story A');
    expect(first[0]).toMatchObject({ name: 'Aiko', staticTags: '', sourceNote: NPC_AUTO_CREATE_SOURCE });
    const filled = applyNpcFirstAppearances([candidate()], first, 'Story A');
    expect(filled[0]).toMatchObject({ id: first[0].id, staticTags: 'blue hair' });
    const again = applyNpcFirstAppearances([candidate({ appearanceTags: 'red hair' })], filled, 'Story A');
    expect(again).toBe(filled);
    expect(first[0].staticTags).toBe('');
  });

  it('同批与后续按姓名和别名去重，不影响其他故事的同名角色', () => {
    const result = applyNpcFirstAppearances([candidate(), candidate({ name: '小爱', aliases: [] })], [], 'Story A');
    expect(result).toHaveLength(1);
    expect(applyNpcFirstAppearances([candidate()], result, 'Story A')).toBe(result);
    expect(applyNpcFirstAppearances([candidate()], result, 'Story B')).toHaveLength(2);
  });

  it('通用库已有人物时不重复建档，也不自动覆盖手动或锁定的空档案', () => {
    const manual = createNpcLibraryEntry('Aiko', 'Story A');
    expect(applyNpcFirstAppearances([candidate()], [manual], 'Story A')[0]).toBe(manual);
    const locked = { ...manual, sourceNote: NPC_AUTO_CREATE_SOURCE, locked: true };
    expect(applyNpcFirstAppearances([candidate()], [locked], 'Story A')[0]).toBe(locked);
    const global = { ...manual, group: NPC_LIBRARY_GLOBAL_GROUP };
    expect(applyNpcFirstAppearances([candidate()], [global], 'Story A')).toEqual([global]);
  });
});
