import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { chat_metadata, eventSource, event_types } from '@sillytavern/script';
import PromptProfilesTab from '@/panel/tabs/PromptProfilesTab.vue';
import { readChatProfiles } from '@/services/prompt-profiles/chat-store';
import type { PromptPerson } from '@/constants/novelai';

const state = vi.hoisted(() => ({ scope: { kind: 'character', avatar: 'Story.png', chatId: 'current' } }));
vi.mock('@/services/sillytavern/chats', () => ({
  getCurrentChatScope: () => state.scope,
  isSameChatScope: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
}));
vi.mock('@/store/settings', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/services/tavern-helper/prompt-profiles-context', () => ({
  getCurrentCharacterKey: () => 'Story', getCurrentUserPersonaKey: () => 'User',
}));
vi.mock('@/services/tavern-helper/prompt-profiles-tags', () => ({
  parsePromptPersonStaticTags: vi.fn(), parsePromptPersonStaticTagsFromText: vi.fn(),
}));
vi.mock('@/panel/components/onboarding/mock-person', () => ({ isTutorialMockPersonId: () => false }));
// 父页只测试同步事件与编辑持久化；来源选择在弹窗测试中单独覆盖。
vi.mock('@/panel/components/PromptProfilesSyncDialog.vue', () => ({
  default: { name: 'PromptProfilesSyncDialog', template: '<div />' },
}));

function person(name: string): PromptPerson {
  return { id: name, name, kind: 'character', enabled: true, insertMode: 'keyword', triggerKeywords: [name], staticTags: 'old tags', negativeTags: 'old negative', templateEntries: [] };
}
let wrapper: VueWrapper;
function mountTab(): void {
  wrapper = shallowMount(PromptProfilesTab, {
    global: {
      provide: { showConfirm: vi.fn().mockResolvedValue(true) },
      stubs: {
        CvMiniButton: { props: ['label'], template: '<button>{{ label }}</button>' },
        CollapsiblePanelItem: { template: '<section><slot name="title" /><slot /></section>' },
        Dialog: { props: ['visible'], template: '<section v-if="visible"><slot /><slot name="footer" /></section>' },
      },
    },
  });
}
beforeEach(() => {
  state.scope = { kind: 'character', avatar: 'Story.png', chatId: 'current' };
  chat_metadata.cosmos_vision_profiles = [person('Existing')];
  chat_metadata.integrity = 'target-integrity';
  chat_metadata.other_plugin = { value: 'target-only' };
});
afterEach(() => {
  wrapper?.unmount();
  delete chat_metadata.cosmos_vision_profiles;
  delete chat_metadata.integrity;
  delete chat_metadata.other_plugin;
});

describe('人物页同步集成', () => {
  it.each([true, false])('有无人物档案（%s）时服装连续性均位于页面底部', hasProfiles => {
    if (!hasProfiles) chat_metadata.cosmos_vision_profiles = [];
    mountTab();
    const outfitPanel = wrapper.findComponent({ name: 'OutfitContinuityPanel' }).element;
    expect(outfitPanel.parentElement!.lastElementChild).toBe(outfitPanel);
  });

  it('同步立即写回当前档案，不改变来源和其他 metadata', async () => {
    mountTab();
    const source = person('New');
    source.templateEntries = [{ id: 'character-description:source', title: '角色描述', enabled: true, content: '', reference: { characterName: 'Original' } }];
    wrapper.findComponent({ name: 'PromptProfilesSyncDialog' }).vm.$emit('sync', [source], 'missing', { ...state.scope });
    await nextTick();
    expect(readChatProfiles().map(item => item.name)).toEqual(['Existing', 'New']);
    const imported = readChatProfiles()[1];
    expect(imported.id).not.toBe(source.id);
    expect(imported.templateEntries[0].id).toMatch(/^character-description:/);
    expect(imported.templateEntries[0].reference).toEqual({ characterName: 'Original' });
    expect(source.id).toBe('New');
    expect(source.templateEntries[0].id).toBe('character-description:source');
    expect(chat_metadata.integrity).toBe('target-integrity');
    expect(chat_metadata.other_plugin).toEqual({ value: 'target-only' });
    expect(wrapper.text()).toContain('New');
  });

  it.each([
    { draft: 'image tags', showNegative: false },
    { draft: { positiveTags: 'image tags', negativeTags: 'image negative' }, showNegative: true },
  ])('图片草稿兼容 WD 字符串与元数据正负对象，并按操作侧写回当前聊天（$showNegative）', async ({ draft, showNegative }) => {
    mountTab();
    await wrapper.findAll('button').find(button => button.text() === '从资料解析')!.trigger('click');
    await wrapper.findAll('button').find(button => button.text().includes('从图片提取'))!.trigger('click');
    wrapper.findComponent({ name: 'WdTaggerSource' }).vm.$emit('draft', draft);
    await nextTick();
    const result = wrapper.findComponent({ name: 'StaticTagsDraftResult' });
    expect(result.props('showNegative')).toBe(showNegative);
    expect(result.props('draft')).toEqual({
      positiveTags: 'image tags', negativeTags: typeof draft === 'string' ? '' : draft.negativeTags,
    });
    result.vm.$emit('replace', { positive: 'selected positive' });
    expect(readChatProfiles()[0]).toMatchObject({ staticTags: 'selected positive', negativeTags: 'old negative' });
    if (showNegative) {
      result.vm.$emit('replace', { negative: 'selected negative' });
      result.vm.$emit('append', { negative: 'extra negative' });
      expect(readChatProfiles()[0]).toMatchObject({
        staticTags: 'selected positive', negativeTags: 'selected negative, extra negative',
      });
    }
  });

  it('拒绝来源加载时捕获的旧聊天目标，即使聊天 ID 相同', () => {
    mountTab();
    const original = { ...state.scope };
    state.scope.avatar = 'Other.png';
    wrapper.findComponent({ name: 'PromptProfilesSyncDialog' }).vm.$emit('sync', [person('Wrong')], 'missing', original);
    expect(readChatProfiles().map(item => item.name)).toEqual(['Existing']);
    expect(toastr.warning).toHaveBeenCalledWith(expect.stringContaining('未同步'));
  });

  it('覆盖保留目标 ID 和其他档案，后续编辑同步即时写回', async () => {
    mountTab();
    const replacement = { ...person('Existing'), id: 'source-id', staticTags: 'new tags', negativeTags: 'new negative' };
    wrapper.findComponent({ name: 'PromptProfilesSyncDialog' }).vm.$emit('sync', [replacement], 'overwrite', { ...state.scope });
    await nextTick();
    expect(readChatProfiles()[0]).toMatchObject({ id: 'Existing', staticTags: 'new tags', negativeTags: 'new negative' });
    const textareas = wrapper.findAllComponents({ name: 'CvExpandableTextarea' });
    textareas[0].vm.$emit('update:modelValue', 'edited tags');
    textareas[1].vm.$emit('update:modelValue', 'edited negative');
    // flush: sync 防止紧接着切聊天时，将尚未写入的编辑丢失或写入新聊天。
    expect(readChatProfiles()[0]).toMatchObject({ staticTags: 'edited tags', negativeTags: 'edited negative' });
    expect(replacement.negativeTags).toBe('new negative');
    chat_metadata.cosmos_vision_profiles = [person('Next chat')];
    state.scope.chatId = 'next';
    eventSource.emit(event_types.CHAT_CHANGED);
    await nextTick();
    expect(wrapper.text()).toContain('Next chat');
    expect(readChatProfiles().map(item => item.name)).toEqual(['Next chat']);
  });
});
