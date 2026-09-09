import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chat_metadata } from '@sillytavern/script';
import type { PromptPerson, PromptProfilesSettings } from '@/constants/novelai';
import {
  hasActiveChatProfiles,
  importLegacyGlobalProfiles,
  persistChatProfiles,
  readChatProfiles,
} from '@/services/prompt-profiles/chat-store';

const PROFILES_KEY = 'cosmos_vision_profiles';

beforeEach(() => {
  delete chat_metadata[PROFILES_KEY];
});

describe('chat-store 人物档案 per-chat 存储', () => {
  it('round-trips profiles through chat metadata', () => {
    persistChatProfiles([createProfile('莉娜', 'character'), createProfile('玩家', 'user')]);
    const profiles = readChatProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({ name: '莉娜', kind: 'character', staticTags: '1girl' });
    expect(profiles[1]).toMatchObject({ name: '玩家', kind: 'user' });
  });

  it('returns empty list when metadata missing', () => {
    expect(readChatProfiles()).toEqual([]);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const warn = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    (chat_metadata as Record<string, unknown>)[PROFILES_KEY] = [
      createProfile('莉娜', 'character'),
      { name: '没有kind' },
      'not an object',
      { kind: 'character' },
    ];
    const profiles = readChatProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.name).toBe('莉娜');
    warn.mockRestore();
  });

  it('normalizes invalid enum fields with defaults', () => {
    (chat_metadata as Record<string, unknown>)[PROFILES_KEY] = [
      {
        id: 'x',
        name: '莉娜',
        kind: 'character',
        enabled: 'yes',
        insertMode: 'sometimes',
        triggerKeywords: 'not-array',
      },
    ];
    const profile = readChatProfiles()[0]!;
    expect(profile.enabled).toBe(true);
    expect(profile.insertMode).toBe('keyword');
    expect(profile.triggerKeywords).toEqual([]);
  });

  it('detects active profiles for reminder gating', () => {
    expect(hasActiveChatProfiles()).toBe(false);
    persistChatProfiles([createProfile('莉娜', 'character')]);
    expect(hasActiveChatProfiles()).toBe(true);
    persistChatProfiles([{ ...createProfile('莉娜', 'character'), enabled: false }]);
    expect(hasActiveChatProfiles()).toBe(false);
  });

  it('imports legacy global profiles without duplicating existing names', () => {
    const legacy: PromptProfilesSettings = {
      profiles: [createProfile('莉娜', 'character'), createProfile('旧角色', 'character')],
    };
    persistChatProfiles([createProfile('莉娜', 'character')]);

    const imported = importLegacyGlobalProfiles(legacy);
    expect(imported.map(profile => profile.name)).toEqual(['旧角色']);

    const merged = readChatProfiles();
    expect(merged).toHaveLength(2);
    // 新导入档案带新 id，避免与已有档案冲突
    expect(imported[0]!.id).not.toBe(legacy.profiles[1]!.id);
  });
});

function createProfile(name: string, kind: PromptPerson['kind']): PromptPerson {
  return {
    id: `id-${name}`,
    name,
    kind,
    enabled: true,
    insertMode: 'keyword',
    triggerKeywords: [name],
    staticTags: '1girl',
    templateEntries: [],
  };
}
