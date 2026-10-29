import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv4 } from '@sillytavern/scripts/utils';

import {
  getPromptPersonTemplateEntryKind,
  normalizePromptPersonTemplateEntryId,
  PROMPT_PERSON_TEMPLATE_ENTRY_KINDS,
  type PromptPerson,
} from '@/constants/prompt-llm';
import {
  applyChatProfileSync,
  getChatProfileSyncKey,
  previewChatProfileSync,
  type ChatProfileSyncMode,
} from '@/services/prompt-profiles/chat-sync';

vi.mock('@sillytavern/scripts/utils', () => ({ uuidv4: vi.fn() }));

const MODES: ChatProfileSyncMode[] = ['missing', 'overwrite'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function person(overrides: Partial<PromptPerson> = {}): PromptPerson {
  return {
    id: 'source-person', name: 'Alice', kind: 'character', enabled: true, insertMode: 'keyword',
    triggerKeywords: ['Alice'], staticTags: 'blue eyes',
    templateEntries: [{
      id: 'character-worldbook-entry:source-entry', title: 'Worldbook', enabled: true, content: 'source content',
      reference: { worldbookName: 'World', entryUid: 42, characterName: 'Alice' },
    }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  let id = 0;
  vi.mocked(uuidv4).mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`);
});

describe('getChatProfileSyncKey', () => {
  it('matches trimmed lowercase names but distinguishes user and character profiles', () => {
    const character = person({ name: '  ALIce  ' });
    const sameCharacter = person({ id: 'another-id', name: 'alice' });
    const user = person({ kind: 'user', name: 'alice' });
    expect(getChatProfileSyncKey(character)).toBe(getChatProfileSyncKey(sameCharacter));
    expect(getChatProfileSyncKey(character)).not.toBe(getChatProfileSyncKey(user));
    expect(getChatProfileSyncKey(person({ name: 'Alice Smith' })))
      .not.toBe(getChatProfileSyncKey(person({ name: 'Alice  Smith' })));
  });
});

describe('previewChatProfileSync', () => {
  it.each(MODES)('adds a same-named person of a different kind in %s mode', mode => {
    const source = person({ kind: 'user' });
    expect(previewChatProfileSync([person()], [source], mode)).toEqual([{ source, action: 'add' }]);
  });

  it('skips matches and adds missing profiles in source order in missing mode', () => {
    const existing = person({ id: 'target', name: '  ALICE ' });
    const selected = [person({ name: 'Bob' }), person({ name: ' alice ' })];
    expect(previewChatProfileSync([existing], selected, 'missing')).toEqual([
      { source: selected[0], action: 'add' },
      { source: selected[1], action: 'skip' },
    ]);
    expect(selected[1].name).toBe(' alice ');
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it('overwrites only a unique match and adds missing profiles in overwrite mode', () => {
    const selected = [person({ name: ' alice ' }), person({ name: 'Bob' })];
    expect(previewChatProfileSync([person({ name: ' ALICE ' })], selected, 'overwrite')).toEqual([
      { source: selected[0], action: 'overwrite' },
      { source: selected[1], action: 'add' },
    ]);
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it.each(MODES)('handles duplicate targets without guessing in %s mode', mode => {
    const source = person();
    const existing = [person({ id: 'target-a' }), person({ id: 'target-b', name: ' ALICE ' })];
    expect(previewChatProfileSync(existing, [source], mode)).toEqual([
      { source, action: mode === 'missing' ? 'skip' : 'conflict' },
    ]);
  });

  it.each(MODES)('marks all duplicate sources as conflicts even when there is no target in %s mode', mode => {
    const selected = [person(), person({ id: 'second-source', name: ' ALICE ' }), person({ name: 'Bob' })];
    expect(previewChatProfileSync([], selected, mode)).toEqual([
      { source: selected[0], action: 'conflict' },
      { source: selected[1], action: 'conflict' },
      { source: selected[2], action: 'add' },
    ]);
  });

  it.each(MODES)('duplicate sources take precedence over a unique or duplicate target in %s mode', mode => {
    const selected = [person(), person({ id: 'duplicate', name: ' alice ' })];
    for (const existing of [[person()], [person(), person({ id: 'duplicate-target' })]]) {
      expect(previewChatProfileSync(existing, selected, mode).map(item => item.action)).toEqual(['conflict', 'conflict']);
    }
    expect(uuidv4).not.toHaveBeenCalled();
  });
});

describe('applyChatProfileSync', () => {
  it('adds a new person and regenerates all template UUIDs while preserving each source-kind prefix', () => {
    const source = person({
      templateEntries: PROMPT_PERSON_TEMPLATE_ENTRY_KINDS.map(kind => ({
        id: normalizePromptPersonTemplateEntryId('source-entry', kind), title: kind,
        enabled: false, content: `${kind} content`,
        reference: kind === 'custom' ? undefined : { characterName: 'Alice' },
      })),
    });
    const { profiles, items } = applyChatProfileSync([], [source], 'missing');
    const added = profiles[0];
    expect(items).toEqual([{ source, action: 'add' }]);
    expect(items[0].source).toBe(source);
    expect(added.id).not.toBe(source.id);
    expect(added.id).toMatch(UUID_PATTERN);
    expect(added.templateEntries.map(getPromptPersonTemplateEntryKind)).toEqual([...PROMPT_PERSON_TEMPLATE_ENTRY_KINDS]);
    for (const [index, entry] of added.templateEntries.entries()) {
      expect(entry.id).not.toBe(source.templateEntries[index].id);
      expect(entry.id.split(':').pop()).toMatch(UUID_PATTERN);
      expect(entry).toEqual({ ...source.templateEntries[index], id: entry.id });
      expect(entry).not.toBe(source.templateEntries[index]);
    }
    expect(new Set([added.id, ...added.templateEntries.map(entry => entry.id.split(':').pop())]).size)
      .toBe(1 + source.templateEntries.length);
    expect(uuidv4).toHaveBeenCalledTimes(1 + source.templateEntries.length);
  });

  it('overwrites all content in place but preserves the unique target person ID', () => {
    const before = person({ id: 'before-id', name: 'Before' });
    const target = person({
      id: 'stable-target-id', name: 'ALICE', enabled: true, insertMode: 'always', triggerKeywords: ['old'],
      staticTags: 'old tags', templateEntries: [{ id: 'old-entry', title: 'Old', enabled: true, content: 'old' }],
    });
    const after = person({ id: 'after-id', name: 'After' });
    const source = person({ name: ' alice ', enabled: false, triggerKeywords: [], staticTags: 'replacement' });
    const { profiles, items } = applyChatProfileSync([before, target, after], [source], 'overwrite');
    const replacement = profiles[1];
    expect(items).toEqual([{ source, action: 'overwrite' }]);
    expect(profiles[0]).toBe(before);
    expect(profiles[2]).toBe(after);
    expect(replacement).not.toBe(target);
    expect(replacement).toEqual({
      ...source, id: 'stable-target-id',
      templateEntries: [{ ...source.templateEntries[0], id: replacement.templateEntries[0].id }],
    });
    expect(replacement.templateEntries[0].id).not.toBe(source.templateEntries[0].id);
    expect(getPromptPersonTemplateEntryKind(replacement.templateEntries[0])).toBe('character_worldbook_entry');
    expect(target.staticTags).toBe('old tags');
    expect(source.id).toBe('source-person');
    expect(uuidv4).toHaveBeenCalledOnce();
  });

  it('clears old entries, keywords and references when replacement content is empty', () => {
    const target = person({ id: 'target' });
    const source = person({ templateEntries: [], triggerKeywords: [], staticTags: '' });
    expect(applyChatProfileSync([target], [source], 'overwrite').profiles).toEqual([{ ...source, id: target.id }]);
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it.each(MODES)('does not modify or regenerate IDs for skipped or conflicted targets in %s mode', mode => {
    const existing = [person({ id: 'target-a' }), person({ id: 'target-b', name: ' alice ' })];
    const selected = [person()];
    const { profiles, items } = applyChatProfileSync(existing, selected, mode);
    expect(items[0].action).toBe(mode === 'missing' ? 'skip' : 'conflict');
    expect(profiles).not.toBe(existing);
    expect(profiles).toEqual(existing);
    expect(profiles[0]).toBe(existing[0]);
    expect(profiles[1]).toBe(existing[1]);
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it('keeps a unique matched target unchanged in missing mode', () => {
    const target = person({ id: 'target', name: ' ALICE ', staticTags: 'target content' });
    const { profiles, items } = applyChatProfileSync([target], [person()], 'missing');
    expect(items[0].action).toBe('skip');
    expect(profiles[0]).toBe(target);
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it.each(MODES)('never applies duplicate source keys in %s mode', mode => {
    const target = person({ id: 'target' });
    const selected = [person(), person({ id: 'duplicate-source', name: ' Alice ' })];
    for (const existing of [[], [target]]) {
      const { profiles, items } = applyChatProfileSync(existing, selected, mode);
      expect(items.map(item => item.action)).toEqual(['conflict', 'conflict']);
      expect(profiles).toEqual(existing);
      if (existing.length) expect(profiles[0]).toBe(target);
    }
    expect(uuidv4).not.toHaveBeenCalled();
  });

  it('preserves untouched profile order and appends additions in selection order across mixed actions', () => {
    const untouched = person({ id: 'untouched', name: 'Untouched' });
    const target = person({ id: 'target' });
    const duplicateA = person({ id: 'duplicate-a', name: 'Duplicate' });
    const duplicateB = person({ id: 'duplicate-b', name: ' DUPLICATE ' });
    const existing = [untouched, target, duplicateA, duplicateB];
    const selected = [person({ name: 'New A' }), person({ name: 'Duplicate' }), person(), person({ name: 'New B' })];
    const expectedItems = previewChatProfileSync(existing, selected, 'overwrite');
    const { profiles, items } = applyChatProfileSync(existing, selected, 'overwrite');
    expect(items).toEqual(expectedItems);
    expect(items.map(item => item.action)).toEqual(['add', 'conflict', 'overwrite', 'add']);
    expect(profiles.map(profile => profile.name)).toEqual(['Untouched', 'Alice', 'Duplicate', ' DUPLICATE ', 'New A', 'New B']);
    expect(profiles[0]).toBe(untouched);
    expect(profiles[1].id).toBe(target.id);
    expect(profiles[2]).toBe(duplicateA);
    expect(profiles[3]).toBe(duplicateB);
    expect(existing).toEqual([untouched, target, duplicateA, duplicateB]);
  });

  it.each(MODES)('copies keywords and references so result mutations do not affect sources or replaced targets in %s mode', mode => {
    const source = person();
    const target = person({ id: 'target', staticTags: 'old' });
    const sourceSnapshot = structuredClone(source);
    const targetSnapshot = structuredClone(target);
    Object.freeze(source.triggerKeywords);
    Object.freeze(source.templateEntries[0].reference);
    Object.freeze(source.templateEntries[0]);
    Object.freeze(source.templateEntries);
    Object.freeze(source);
    const existing = mode === 'overwrite' ? [target] : [];
    const copied = applyChatProfileSync(existing, [source], mode).profiles[0];
    expect(copied.triggerKeywords).not.toBe(source.triggerKeywords);
    expect(copied.templateEntries).not.toBe(source.templateEntries);
    expect(copied.templateEntries[0].reference).not.toBe(source.templateEntries[0].reference);
    copied.name = 'Changed';
    copied.triggerKeywords.push('Changed');
    copied.templateEntries[0].content = 'Changed';
    copied.templateEntries[0].reference!.worldbookName = 'Changed';
    copied.templateEntries.push({ id: 'new', title: 'New', enabled: true, content: '' });
    expect(source).toEqual(sourceSnapshot);
    expect(target).toEqual(targetSnapshot);
  });

  it('generates independent IDs and references across multiple additions and repeated applications', () => {
    const selected = [person(), person({ id: 'source-b', name: 'Bob' })];
    const first = applyChatProfileSync([], selected, 'missing').profiles;
    const second = applyChatProfileSync([], selected, 'missing').profiles;
    const ids = [...first, ...second].flatMap(profile => [profile.id, ...profile.templateEntries.map(entry => entry.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(first[0].templateEntries[0].reference).not.toBe(second[0].templateEntries[0].reference);
  });

  it.each(MODES)('returns a new array with unchanged profiles for an empty selection in %s mode', mode => {
    const existing = [person()];
    const { profiles, items } = applyChatProfileSync(existing, [], mode);
    expect(items).toEqual([]);
    expect(profiles).not.toBe(existing);
    expect(profiles[0]).toBe(existing[0]);
    expect(uuidv4).not.toHaveBeenCalled();
  });
});
