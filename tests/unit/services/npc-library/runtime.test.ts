import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNpcLibraryEntry, NPC_LIBRARY_GLOBAL_GROUP, type NpcLibraryEntry } from '@/constants/npc-library';

vi.mock('@/services/npc-library/store', () => ({
  readNpcLibraryEntries: vi.fn(),
}));
vi.mock('@/services/tavern-helper/prompt-profiles-context', () => ({
  getCurrentCharacterKey: vi.fn(),
}));

import { readNpcLibraryEntries } from '@/services/npc-library/store';
import { getCurrentCharacterKey } from '@/services/tavern-helper/prompt-profiles-context';
import { buildNpcLibraryParticipants, npcEntryToPromptPerson } from '@/services/prompt-profiles/runtime';

const mockedReadEntries = vi.mocked(readNpcLibraryEntries);
const mockedGetGroup = vi.mocked(getCurrentCharacterKey);

/** 造一个带固定 tag 的库条目 */
function makeEntry(overrides: Partial<NpcLibraryEntry>): NpcLibraryEntry {
  return { ...createNpcLibraryEntry('Aiko', 'Story A', ['aiko']), staticTags: 'blue hair, red eyes', ...overrides };
}

describe('npcEntryToPromptPerson', () => {
  it('carries name, aliases, insertMode and staticTags into a character person', () => {
    const entry = makeEntry({ name: 'Aiko', aliases: ['小爱'], insertMode: 'keyword', staticTags: 'blue hair' });
    const person = npcEntryToPromptPerson(entry);
    expect(person.kind).toBe('character');
    expect(person.name).toBe('Aiko');
    expect(person.triggerKeywords).toEqual(expect.arrayContaining(['Aiko', '小爱']));
    expect(person.insertMode).toBe('keyword');
    expect(person.staticTags).toBe('blue hair');
  });

  it('injects appearanceNote as an extra template entry before the closing tag', () => {
    const entry = makeEntry({ appearanceNote: 'scar across left cheek' });
    const person = npcEntryToPromptPerson(entry);
    const contents = person.templateEntries.map(item => item.content);
    expect(contents.some(content => content.includes('scar across left cheek'))).toBe(true);
    expect(person.templateEntries.at(-1)?.content).toContain('</person>');
  });
});

describe('buildNpcLibraryParticipants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGroup.mockReturnValue('Story A');
  });

  it('injects a matching NPC of the current story group', async () => {
    mockedReadEntries.mockReturnValue([makeEntry({ name: 'Aiko', group: 'Story A', staticTags: 'blue hair' })]);
    const result = await buildNpcLibraryParticipants(['Aiko walks into the room.']);
    expect(result).toContain('<person');
    expect(result).toContain('blue hair');
  });

  it('excludes NPCs belonging to another story group', async () => {
    mockedReadEntries.mockReturnValue([makeEntry({ name: 'Aiko', group: 'Story B' })]);
    const result = await buildNpcLibraryParticipants(['Aiko walks into the room.']);
    expect(result).toBe('');
  });

  it('always injects a matching NPC of the global group regardless of current story', async () => {
    mockedGetGroup.mockReturnValue('Story A');
    mockedReadEntries.mockReturnValue([makeEntry({ name: 'Aiko', group: NPC_LIBRARY_GLOBAL_GROUP })]);
    const result = await buildNpcLibraryParticipants(['Aiko walks into the room.']);
    expect(result).toContain('<person');
  });

  it('skips NPCs whose name is already matched by chat profiles (dedupe)', async () => {
    mockedReadEntries.mockReturnValue([makeEntry({ name: 'Aiko', group: 'Story A' })]);
    const result = await buildNpcLibraryParticipants(['Aiko walks into the room.'], ['aiko']);
    expect(result).toBe('');
  });

  it('does not inject when the keyword is absent from context', async () => {
    mockedReadEntries.mockReturnValue([makeEntry({ name: 'Aiko', group: 'Story A', insertMode: 'keyword' })]);
    const result = await buildNpcLibraryParticipants(['Nobody is here.']);
    expect(result).toBe('');
  });
});
