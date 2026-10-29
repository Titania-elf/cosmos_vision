import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat_metadata, saveChatDebounced } from '@sillytavern/script';
import { uuidv4 } from '@sillytavern/scripts/utils';

import {
  CHAT_PROFILES_CHANGED,
  hasActiveChatProfiles,
  persistChatProfiles,
  readChatProfiles,
  readLegacyGlobalProfiles,
  readProfilesFromMetadata,
} from '@/services/prompt-profiles/chat-store';

vi.mock('@sillytavern/script', () => ({
  chat_metadata: {},
  saveChatDebounced: vi.fn(),
}));
vi.mock('@sillytavern/scripts/utils', () => ({ uuidv4: vi.fn() }));

const METADATA_KEY = 'cosmos_vision_profiles';

function rawProfile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'source-person',
    name: 'Alice',
    kind: 'character',
    enabled: true,
    insertMode: 'keyword',
    triggerKeywords: ['Alice'],
    staticTags: 'blue eyes',
    templateEntries: [],
    ...overrides,
  };
}

function readProfile(overrides: Record<string, unknown> = {}) {
  return readProfilesFromMetadata({ [METADATA_KEY]: [rawProfile(overrides)] })[0];
}

beforeEach(() => {
  for (const key of Object.keys(chat_metadata)) delete chat_metadata[key];
  vi.clearAllMocks();
  let id = 0;
  vi.mocked(uuidv4).mockImplementation(() => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`);
});

describe('readProfilesFromMetadata', () => {
  it.each([undefined, null, false, 1, 'metadata', [], {}, { [METADATA_KEY]: {} }])(
    'returns no profiles for invalid or missing metadata: %j',
    metadata => {
      expect(readProfilesFromMetadata(metadata)).toEqual([]);
    },
  );

  it('silently handles a metadata property that cannot be read', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const metadata = Object.defineProperty({}, METADATA_KEY, {
        get() { throw new Error('unavailable metadata'); },
      });
      expect(readProfilesFromMetadata(metadata)).toEqual([]);
      expect(debug).toHaveBeenCalledOnce();
    } finally {
      debug.mockRestore();
    }
  });

  it('discards invalid profiles while preserving the order of valid profiles', () => {
    const first = rawProfile({ name: '  Alice  ' });
    const second = rawProfile({ id: 'user-id', name: 'Bob', kind: 'user' });
    const badArray = Object.assign([], rawProfile());
    const profiles = readProfilesFromMetadata({
      [METADATA_KEY]: [
        null, false, 1, 'invalid', [], badArray,
        rawProfile({ kind: 'npc' }), rawProfile({ name: '   ' }), rawProfile({ name: 123 }),
        first, {}, second,
      ],
    });
    expect(profiles.map(person => [person.id, person.kind, person.name])).toEqual([
      ['source-person', 'character', 'Alice'],
      ['user-id', 'user', 'Bob'],
    ]);
    expect(first.name).toBe('  Alice  ');
  });

  it('retains existing normalization defaults and filters duplicate or invalid keywords', () => {
    const person = readProfile({
      id: '   ', enabled: 'false', insertMode: 'invalid', staticTags: {},
      triggerKeywords: ['Alice', '', '  ', 1, null, 'Alice', ' Alice '],
      templateEntries: null,
    });
    expect(person).toEqual({
      id: expect.any(String), name: 'Alice', kind: 'character', enabled: true,
      insertMode: 'keyword', staticTags: '', triggerKeywords: ['Alice', ' Alice '], templateEntries: [],
    });
    expect(person.id.trim()).not.toBe('');
    expect(uuidv4).toHaveBeenCalledOnce();
    expect(readProfile({ enabled: false, insertMode: 'always', triggerKeywords: {} })).toMatchObject({
      enabled: false, insertMode: 'always', triggerKeywords: [],
    });
  });

  it('drops malformed template entries and normalizes valid entries without changing source IDs', () => {
    const person = readProfile({
      templateEntries: [
        null, false, 1, 'bad', [], Object.assign([], { title: 'array' }), {}, { title: '  ' },
        { id: 'character-description:original', title: '  Description  ', enabled: false, content: 'details' },
        { id: '', title: 'Custom', enabled: 'false', content: 123 },
      ],
    });
    expect(person.templateEntries).toEqual([
      { id: 'character-description:original', title: 'Description', enabled: false, content: 'details', reference: undefined },
      { id: expect.any(String), title: 'Custom', enabled: true, content: '', reference: undefined },
    ]);
    expect(uuidv4).toHaveBeenCalledOnce();
  });

  it('copies only known reference fields with valid types, including entry UID zero', () => {
    const reference = {
      worldbookName: 'World', characterName: 'Alice', personaId: 'persona-id', personaName: 'User', entryUid: 0,
      unknown: { nested: 'must not leak' },
    };
    const person = readProfile({ templateEntries: [{ id: 'entry', title: 'Entry', reference }] });
    expect(person.templateEntries[0].reference).toEqual({
      worldbookName: 'World', characterName: 'Alice', personaId: 'persona-id', personaName: 'User', entryUid: 0,
    });
    expect(person.templateEntries[0].reference).not.toBe(reference);

    const filtered = readProfile({
      templateEntries: [{
        id: 'entry', title: 'Entry',
        reference: { worldbookName: 'World', characterName: {}, personaId: 1, personaName: null, entryUid: '42' },
      }],
    });
    expect(filtered.templateEntries[0].reference).toEqual({ worldbookName: 'World' });
  });

  it.each([null, false, 'bad', [], {}, { unknown: 'value' }, { entryUid: NaN }, { entryUid: Infinity }, { characterName: {} }])(
    'discards references without any valid known field: %j',
    reference => {
      expect(readProfile({ templateEntries: [{ id: 'entry', title: 'Entry', reference }] }).templateEntries[0].reference)
        .toBeUndefined();
    },
  );

  it('does not share profiles, keywords, entries or references with metadata or another read', () => {
    const reference = { worldbookName: 'World', entryUid: 42 };
    const entry = { id: 'entry', title: 'Entry', content: 'original', reference };
    const original = rawProfile({ templateEntries: [entry] });
    const metadata = { [METADATA_KEY]: [original] };
    const first = readProfilesFromMetadata(metadata)[0];
    const second = readProfilesFromMetadata(metadata)[0];

    expect(first).not.toBe(original);
    expect(first.triggerKeywords).not.toBe(original.triggerKeywords);
    expect(first.templateEntries).not.toBe(original.templateEntries);
    expect(first.templateEntries[0]).not.toBe(entry);
    expect(first.templateEntries[0].reference).not.toBe(second.templateEntries[0].reference);
    first.name = 'changed';
    first.triggerKeywords.push('changed');
    first.templateEntries[0].content = 'changed';
    first.templateEntries[0].reference!.worldbookName = 'changed';
    expect(original.name).toBe('Alice');
    expect(original.triggerKeywords).toEqual(['Alice']);
    expect(entry.content).toBe('original');
    expect(reference.worldbookName).toBe('World');
    expect(second).toEqual(readProfilesFromMetadata(metadata)[0]);
    expect(saveChatDebounced).not.toHaveBeenCalled();
  });
});

describe('chat-store integration', () => {
  it('readChatProfiles uses metadata normalization without writing or saving it', () => {
    const raw = [rawProfile({ name: '  Alice  ' }), rawProfile({ kind: 'invalid' })];
    chat_metadata[METADATA_KEY] = raw;
    expect(readChatProfiles()).toEqual(readProfilesFromMetadata(chat_metadata));
    expect(chat_metadata[METADATA_KEY]).toBe(raw);
    expect(raw[0].name).toBe('  Alice  ');
    expect(saveChatDebounced).not.toHaveBeenCalled();
  });

  it('preserves explicit persistence and enabled-profile detection', () => {
    const profiles = [readProfile({ enabled: false })];
    persistChatProfiles(profiles);
    expect(chat_metadata[METADATA_KEY]).toBe(profiles);
    expect(saveChatDebounced).toHaveBeenCalledOnce();
    expect(hasActiveChatProfiles()).toBe(false);
    profiles[0].enabled = true;
    expect(hasActiveChatProfiles()).toBe(true);
  });

  it('dispatches the shared change event after metadata has been written and saving scheduled', () => {
    const profiles = [readProfile()];
    const listener = vi.fn((event: Event) => {
      expect(event).toBeInstanceOf(Event);
      expect(chat_metadata[METADATA_KEY]).toBe(profiles);
      expect(saveChatDebounced).toHaveBeenCalledOnce();
    });
    window.addEventListener(CHAT_PROFILES_CHANGED, listener);
    try {
      expect(CHAT_PROFILES_CHANGED).toBe('cosmos-vision:chat-profiles-changed');
      persistChatProfiles(profiles);
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toBeInstanceOf(Event);
    } finally {
      window.removeEventListener(CHAT_PROFILES_CHANGED, listener);
    }
  });

  it('reading profiles and checking active profiles do not dispatch change events', () => {
    const listener = vi.fn();
    window.addEventListener(CHAT_PROFILES_CHANGED, listener);
    try {
      chat_metadata[METADATA_KEY] = [rawProfile()];
      readProfilesFromMetadata(chat_metadata);
      readChatProfiles();
      hasActiveChatProfiles();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CHAT_PROFILES_CHANGED, listener);
    }
  });

  it('legacy normalization also copies and filters template references', () => {
    const source = readProfile({
      templateEntries: [{ id: 'entry', title: 'Entry', reference: { characterName: 'Alice' } }],
    });
    const [legacy] = readLegacyGlobalProfiles({ profiles: [source] });
    expect(legacy).toEqual(source);
    expect(legacy.templateEntries[0].reference).not.toBe(source.templateEntries[0].reference);
  });
});
