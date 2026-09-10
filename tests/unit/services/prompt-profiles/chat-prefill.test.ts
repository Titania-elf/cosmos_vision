import { beforeEach, describe, expect, it, vi } from 'vitest';

import { chat_metadata } from '@sillytavern/script';
import { power_user } from '@sillytavern/scripts/power-user';

/** name2 mock 为 const ''，需通过 vi.mock 替换模块才能让角色 key 可解析 */
const characterNameMock = vi.hoisted(() => ({ value: 'Seraphina' }));
vi.mock('@sillytavern/script', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, name2: characterNameMock.value };
});

import { event_types, eventSource } from '@sillytavern/script';
import { bindChatProfilesPrefill, prefillBlankProfilesForCurrentChat } from '@/services/prompt-profiles/chat-prefill';
import { readChatProfiles } from '@/services/prompt-profiles/chat-store';
import { getPromptPersonTemplateEntryKind } from '@/constants/novelai';

const PROFILES_KEY = 'cosmos_vision_profiles';
const PREFILL_FLAG_KEY = 'cosmos_vision_profiles_prefilled';

beforeEach(() => {
  delete chat_metadata[PROFILES_KEY];
  delete chat_metadata[PREFILL_FLAG_KEY];
  delete chat_metadata.persona;
  (power_user as { default_persona: string | null }).default_persona = 'Alice';
  vi.restoreAllMocks();
});

describe('chat-prefill 新聊天人物档案预填', () => {
  it('为当前角色卡与用户人设各建一份档案', () => {
    const created = prefillBlankProfilesForCurrentChat();

    const kinds = created.map(person => person.kind).sort();
    expect(kinds).toEqual(['character', 'user']);
    expect(readChatProfiles()).toHaveLength(2);
  });

  it('预填档案保留人物开始条目：固定 tag 复述指令与 <person> 结构完整', () => {
    prefillBlankProfilesForCurrentChat();

    for (const person of readChatProfiles()) {
      const titles = person.templateEntries.map(entry => entry.title);
      expect(titles[0]).toBe('人物开始');
      expect(titles.at(-1)).toBe('人物结束');
      const startContent = person.templateEntries[0]!.content;
      expect(startContent).toContain('<person name=');
      expect(startContent).toContain('必须原样体现在最终正向提示词中');
      // 资料条目夹在人物开始/结束之间
      const sourceKind = person.kind === 'character' ? 'character_description' : 'user_persona';
      expect(person.templateEntries.some(entry => getPromptPersonTemplateEntryKind(entry) === sourceKind)).toBe(true);
    }
  });

  it('同一聊天重复预填幂等', () => {
    prefillBlankProfilesForCurrentChat();
    const again = prefillBlankProfilesForCurrentChat();

    expect(again).toEqual([]);
    expect(readChatProfiles()).toHaveLength(2);
  });

  it('CHAT_CHANGED 事件触发预填', () => {
    bindChatProfilesPrefill();

    eventSource.emit(event_types.CHAT_CHANGED, undefined);

    expect(readChatProfiles()).toHaveLength(2);
  });
});
