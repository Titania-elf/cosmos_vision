import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import NpcLibraryTab from '@/panel/tabs/NpcLibraryTab.vue';
import { createNpcLibraryEntry, type NpcLibrarySettings } from '@/constants/npc-library';

vi.mock('@/store/settings', () => ({ useSettingsStore: () => store }));
vi.mock('@/services/tavern-helper/prompt-profiles-context', () => ({
  getCurrentCharacterKey: () => 'Story A',
  getCurrentUserPersonaKey: () => 'User',
}));

const savedSettings = reactive({
  npcLibrary: { entries: [createNpcLibraryEntry('Aiko', 'Story A')] },
  promptLlm: { useNpcLibrary: true, autoUpdateNpcLibrary: false },
});
const store = {
  savedSettings,
  applyNpcLibrarySettings: vi.fn((value: NpcLibrarySettings) => {
    savedSettings.npcLibrary = structuredClone(value);
  }),
  applyNpcLibraryToggles: vi.fn((value: Partial<typeof savedSettings.promptLlm>) => {
    Object.assign(savedSettings.promptLlm, value);
  }),
};
let wrapper: VueWrapper;
beforeEach(() => {
  savedSettings.npcLibrary = { entries: [createNpcLibraryEntry('Aiko', 'Story A')] };
  savedSettings.promptLlm.autoUpdateNpcLibrary = false;
});
afterEach(() => wrapper?.unmount());

describe('NPC 库实时同步', () => {
  it('配角建档开关可随时启停，关闭时仍可手动建档且保留已有档案', async () => {
    wrapper = shallowMount(NpcLibraryTab, {
      global: {
        provide: { showConfirm: vi.fn() },
        stubs: {
          Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}</button>' },
        },
      },
    });
    const toggle = wrapper
      .findAllComponents({ name: 'CvMiniToggleSwitch' })
      .find(component => component.attributes('aria-label') === '配角首次出场自动建档')!;
    expect(toggle.attributes('modelvalue')).toBe('false');
    await toggle.setValue(true);
    expect(savedSettings.promptLlm.autoUpdateNpcLibrary).toBe(true);
    await toggle.setValue(false);
    expect(savedSettings.promptLlm.autoUpdateNpcLibrary).toBe(false);
    expect(savedSettings.npcLibrary.entries).toHaveLength(1);
    const createButton = wrapper.findAll('button').find(button => button.text() === '新建 NPC')!;
    expect(createButton.attributes('disabled')).toBeUndefined();
    await createButton.trigger('click');
    expect(savedSettings.npcLibrary.entries).toHaveLength(2);
  });

  it('面板已打开时显示自动新增的档案，随后编辑已有档案不会丢失新人物', async () => {
    wrapper = shallowMount(NpcLibraryTab, {
      global: { stubs: { CollapsiblePanelItem: { template: '<section><slot name="title" /><slot /></section>' } } },
    });
    savedSettings.npcLibrary = {
      entries: [...savedSettings.npcLibrary.entries, createNpcLibraryEntry('Bela', 'Story A')],
    };
    await nextTick();
    expect(wrapper.text()).toContain('Bela');
    const fields = wrapper.findAllComponents({ name: 'CvExpandableTextarea' });
    await fields[0].setValue('blue hair');
    expect(savedSettings.npcLibrary.entries).toHaveLength(2);
    expect(savedSettings.npcLibrary.entries[0].staticTags).toBe('blue hair');
    expect(savedSettings.npcLibrary.entries[1].name).toBe('Bela');
  });
});
