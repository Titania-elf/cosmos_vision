import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import * as st from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { createNpcLibraryEntry, NPC_LIBRARY_GLOBAL_GROUP, type NpcLibraryEntry } from '@/constants/npc-library';
import {
  startNpcLibraryAutoUpdate,
  stopNpcLibraryAutoUpdate,
  installNpcHiddenRegex,
} from '@/services/npc-library/auto-update';
import { requestPromptLlmWithAccounts } from '@/services/prompt-llm/runtime-request';
import { getCurrentCharacterKey } from '@/services/tavern-helper/prompt-profiles-context';

vi.mock('@sillytavern/script', async importOriginal => ({
  ...(await importOriginal<object>()),
  getCurrentChatId: vi.fn(() => 'chat-a'),
  setExtensionPrompt: vi.fn(),
}));
vi.mock('@/services/tavern-helper/prompt-profiles-context', () => ({
  getCurrentCharacterKey: vi.fn(() => 'Story A'),
  getCurrentUserPersonaKey: vi.fn(() => 'User'),
}));
vi.mock('@/services/prompt-llm/runtime-request', () => ({ requestPromptLlmWithAccounts: vi.fn() }));
vi.mock('@/store/settings', () => ({ useSettingsStore: () => store }));

const savedSettings = reactive({
  enabled: true,
  promptLlm: { autoUpdateNpcLibrary: true },
  npcLibrary: { entries: [] as NpcLibraryEntry[] },
});
const store = {
  savedSettings,
  applyNpcLibrarySettings: vi.fn((value: { entries: NpcLibraryEntry[] }) => {
    savedSettings.npcLibrary = value;
  }),
};
const injected = () => vi.mocked(st.setExtensionPrompt).mock.calls.at(-1)?.[1] ?? '';
function message(name: string, tags = '', aliases: string[] = [], role = 'supporting') {
  return {
    mes: `正文\n<!-- cv-npcs ${JSON.stringify({ npcs: [{ name, role, aliases, appearanceTags: tags, appearanceNote: '' }] })} -->`,
    is_user: false,
  };
}
function emitMessage(name: string, tags = '', aliases: string[] = []) {
  st.chat.push(message(name, tags, aliases));
  st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, st.chat.length - 1);
}

beforeEach(() => {
  st.chat.length = 0;
  savedSettings.enabled = true;
  savedSettings.promptLlm.autoUpdateNpcLibrary = true;
  savedSettings.npcLibrary.entries = [];
  vi.mocked(getCurrentCharacterKey).mockReturnValue('Story A');
  vi.mocked(st.getCurrentChatId).mockReturnValue('chat-a');
  startNpcLibraryAutoUpdate();
});
afterEach(() => stopNpcLibraryAutoUpdate());

describe('随正文自动建档', () => {
  it('首次仅姓名建档，后续补全身体外观，再次出场不覆盖，整个流程没有提取 API 调用', () => {
    emitMessage('Aiko', '', ['小爱']);
    expect(savedSettings.npcLibrary.entries[0]).toMatchObject({ name: 'Aiko', staticTags: '', group: 'Story A' });
    expect(injected()).toContain('"awaitingAppearance":[{"name":"Aiko"');
    emitMessage('小爱', 'blue hair, red dress', ['Aiko']);
    expect(savedSettings.npcLibrary.entries).toHaveLength(1);
    expect(savedSettings.npcLibrary.entries[0].staticTags).toBe('blue hair');
    expect(injected()).toContain('"awaitingAppearance":[]');
    emitMessage('Aiko', 'red hair');
    expect(savedSettings.npcLibrary.entries[0].staticTags).toBe('blue hair');
    expect(requestPromptLlmWithAccounts).not.toHaveBeenCalled();
  });

  it('重复渲染不重复落盘，连续出现的新人物都处理', () => {
    emitMessage('Aiko', 'blue hair');
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, 0);
    expect(store.applyNpcLibrarySettings).toHaveBeenCalledTimes(1);
    emitMessage('Bela', 'red eyes');
    expect(savedSettings.npcLibrary.entries.map(entry => entry.name)).toEqual(['Aiko', 'Bela']);
  });

  it('具名路人先跳过，后续明确成为配角时才建档', () => {
    st.chat.push(message('小王', 'black hair', [], 'incidental'));
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, 0);
    st.chat.push(message('阿明', '', [], 'uncertain'));
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, 1);
    expect(savedSettings.npcLibrary.entries).toEqual([]);
    emitMessage('小王');
    expect(savedSettings.npcLibrary.entries).toHaveLength(1);
    expect(savedSettings.npcLibrary.entries[0]).toMatchObject({ name: '小王', staticTags: '' });
    expect(requestPromptLlmWithAccounts).not.toHaveBeenCalled();
  });

  it('没有记录、损坏记录、主角/用户及用户消息均不建档，不额外请求补救', () => {
    st.chat.push({ mes: '普通聊天' }, { mes: '<!-- cv-npcs invalid -->' });
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, 0);
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, 1);
    emitMessage('Story A', 'black hair');
    emitMessage('User', 'green eyes');
    st.chat.push({ ...message('Fake NPC'), is_user: true });
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, st.chat.length - 1);
    expect(savedSettings.npcLibrary.entries).toEqual([]);
    expect(requestPromptLlmWithAccounts).not.toHaveBeenCalled();
  });

  it('关闭开关/插件立即清除注入并停止建档，quiet/impersonate 同样不处理', () => {
    savedSettings.promptLlm.autoUpdateNpcLibrary = false;
    expect(injected()).toBe('');
    emitMessage('Disabled');
    savedSettings.promptLlm.autoUpdateNpcLibrary = true;
    savedSettings.enabled = false;
    expect(injected()).toBe('');
    emitMessage('Disabled plugin');
    savedSettings.enabled = true;
    for (const type of ['quiet', 'impersonate']) {
      st.eventSource.emit(st.event_types.GENERATION_AFTER_COMMANDS, type);
      expect(injected()).toBe('');
      emitMessage(type);
      st.eventSource.emit(st.event_types.GENERATION_ENDED);
      expect(injected()).toContain('首次出场建档');
    }
    expect(savedSettings.npcLibrary.entries).toEqual([]);
  });

  it('只发送当前故事和通用组的身份名单，切聊天后刷新，不携带完整外观', () => {
    savedSettings.npcLibrary.entries = [
      { ...createNpcLibraryEntry('Aiko', 'Story A'), staticTags: 'unique appearance tag' },
      createNpcLibraryEntry('Bela', 'Story B'),
      createNpcLibraryEntry('Global NPC', NPC_LIBRARY_GLOBAL_GROUP),
    ];
    expect(injected()).toContain('Aiko');
    expect(injected()).toContain('Global NPC');
    expect(injected()).not.toContain('Bela');
    expect(injected()).not.toContain('unique appearance tag');
    vi.mocked(getCurrentCharacterKey).mockReturnValue('Story B');
    st.eventSource.emit(st.event_types.CHAT_CHANGED);
    expect(injected()).toContain('Bela');
    expect(injected()).not.toContain('Aiko');
  });

  it('隐藏规则幂等，保留原始消息和 swipe，不与服装记录混用', () => {
    installNpcHiddenRegex();
    const scripts = extension_settings.regex.filter(script => script.id === 'cosmos-vision-npcs-hidden');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ markdownOnly: true, promptOnly: true, placement: [2] });
    const source = message('Aiko').mes;
    st.chat.push({ mes: source, swipes: [source], swipe_id: 0 });
    st.eventSource.emit(st.event_types.CHARACTER_MESSAGE_RENDERED, 0);
    expect(st.chat[0].mes).toBe(source);
    expect(st.chat[0].swipes).toEqual([source]);
  });
});
