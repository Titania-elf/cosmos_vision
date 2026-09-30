import { describe, expect, it } from 'vitest';

import { createNpcLibraryEntry, type NpcLibraryEntry } from '@/constants/npc-library';
import type { NpcExtractionCandidate } from '@/services/npc-library/extract';
import { applyNpcMergePlans, planNpcMerges } from '@/services/npc-library/merge';

/** 造候选 */
function candidate(overrides: Partial<NpcExtractionCandidate> = {}): NpcExtractionCandidate {
  return { name: 'Aiko', aliases: [], appearanceTags: 'blue hair, red eyes', appearanceNote: '', ...overrides };
}

/** 造已有条目 */
function entry(overrides: Partial<NpcLibraryEntry> = {}): NpcLibraryEntry {
  return { ...createNpcLibraryEntry('Aiko', 'Story A'), staticTags: 'blue hair', ...overrides };
}

describe('planNpcMerges', () => {
  it('plans a create when no existing entry matches the group', () => {
    const [plan] = planNpcMerges([candidate()], [], 'Story A');
    expect(plan.kind).toBe('create');
    expect(plan.accepted).toBe(true);
    expect(plan.mergedTags).toBe('blue hair, red eyes');
  });

  it('plans an update appending only genuinely new tags', () => {
    const [plan] = planNpcMerges([candidate({ appearanceTags: 'blue hair, red eyes, twintails' })], [entry()], 'Story A');
    expect(plan.kind).toBe('update');
    expect(plan.newTags).toEqual(['red eyes', 'twintails']);
    expect(plan.mergedTags).toBe('blue hair, red eyes, twintails');
  });

  it('marks unchanged when candidate adds no new tags', () => {
    const [plan] = planNpcMerges([candidate({ appearanceTags: 'blue hair' })], [entry()], 'Story A');
    expect(plan.kind).toBe('unchanged');
    expect(plan.accepted).toBe(false);
  });

  it('skips a locked entry without proposing tag changes', () => {
    const [plan] = planNpcMerges([candidate({ appearanceTags: 'red eyes' })], [entry({ locked: true })], 'Story A');
    expect(plan.kind).toBe('skip-locked');
    expect(plan.accepted).toBe(false);
    expect(plan.mergedTags).toBe('blue hair');
  });

  it('treats a same-name entry in a different group as a new create', () => {
    const [plan] = planNpcMerges([candidate()], [entry({ group: 'Story B' })], 'Story A');
    expect(plan.kind).toBe('create');
  });
});

describe('applyNpcMergePlans', () => {
  it('adds a new entry for an accepted create', () => {
    const plans = planNpcMerges([candidate()], [], 'Story A');
    const result = applyNpcMergePlans(plans, [], 'chat-scan');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Aiko');
    expect(result[0].staticTags).toBe('blue hair, red eyes');
    expect(result[0].sourceNote).toBe('chat-scan');
  });

  it('updates the matched entry in place for an accepted update', () => {
    const existing = [entry()];
    const plans = planNpcMerges([candidate({ appearanceTags: 'blue hair, twintails' })], existing, 'Story A');
    const result = applyNpcMergePlans(plans, existing, 'chat-scan');
    expect(result).toHaveLength(1);
    expect(result[0].staticTags).toBe('blue hair, twintails');
  });

  it('leaves locked and unaccepted plans untouched', () => {
    const existing = [entry({ locked: true })];
    const plans = planNpcMerges([candidate({ appearanceTags: 'red eyes' })], existing, 'Story A');
    const result = applyNpcMergePlans(plans, existing, 'chat-scan');
    expect(result[0].staticTags).toBe('blue hair');
  });

  it('does not apply a create whose accepted flag was turned off', () => {
    const plans = planNpcMerges([candidate()], [], 'Story A').map(plan => ({ ...plan, accepted: false }));
    const result = applyNpcMergePlans(plans, [], 'chat-scan');
    expect(result).toHaveLength(0);
  });
});
