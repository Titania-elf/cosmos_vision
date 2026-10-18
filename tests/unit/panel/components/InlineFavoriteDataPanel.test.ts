import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { computed, ref } from 'vue';
import InlineFavoriteDataPanel from '@/panel/components/InlineFavoriteDataPanel.vue';
import type { ManagedImageItem } from '@/services/inline-image/managed-images';

vi.mock('@/composables/useManagedImagePreviews', () => ({
  useManagedImagePreviews: () => ({ previewUrls: ref({}), previewStatus: ref({}) }),
}));

// 视口仅渲染第一张，验证导出范围不受虚拟滚动影响。
vi.mock('@/composables/useVirtualCardGrid', () => ({
  useVirtualCardGrid: (items: () => ManagedImageItem[]) => ({
    containerProps: {},
    wrapperProps: {},
    visibleRows: computed(() => [{ rowIndex: 0, items: items().slice(0, 1) }]),
    rowRef: () => () => {},
    scrollToRow: vi.fn(),
  }),
}));

function item(key: string, kind: 'favorite' | 'temporary', characterKey: string, chatId: string): ManagedImageItem {
  return {
    key,
    kind,
    characterKey,
    chatId,
    createdAt: 1,
    sourceId: key,
    slotId: key,
    filePath: '',
    promptSnapshot: {},
  } as ManagedImageItem;
}

const items = [
  item('favorite:1', 'favorite', 'Alice', 'chat-1'),
  item('temporary:2', 'temporary', 'Alice', 'chat-1'),
  item('favorite:3', 'favorite', 'Alice', 'chat-2'),
  item('favorite:4', 'favorite', 'Bob', 'chat-1'),
];

let wrapper: VueWrapper;
function mountPanel() {
  wrapper = shallowMount(InlineFavoriteDataPanel, {
    props: { items, loading: false, busy: false },
    global: {
      stubs: {
        StaticPanel: { template: '<section><slot name="actions" /><slot /></section>' },
        CvMiniButton: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}</button>' },
      },
    },
  });
  return wrapper;
}

function button(label: string) {
  return wrapper.findAll('button').find(button => button.text() === label)!;
}

afterEach(() => wrapper?.unmount());

describe('图片管理批量导出', () => {
  it('默认导出全部图片，类型、角色、聊天筛选共同限定范围', async () => {
    mountPanel();
    await button('批量导出').trigger('click');
    expect(wrapper.emitted('export-items')?.[0]).toEqual([items.map(item => item.key)]);

    const filters = wrapper.findAllComponents({ name: 'Select' });
    await filters[0].setValue('favorite');
    await filters[1].setValue('Alice');
    await filters[2].setValue('Alice::chat-1');
    await button('批量导出').trigger('click');
    expect(wrapper.emitted('export-items')?.[1]).toEqual([['favorite:1']]);
    expect(wrapper.text()).toContain('当前筛选 1 张');
  });

  it('全选覆盖未渲染图片，缩小筛选范围后不导出隐藏的已选项', async () => {
    mountPanel();
    await button('选择').trigger('click');
    await button('全选').trigger('click');
    await button('导出选中').trigger('click');
    expect(wrapper.emitted('export-items')?.[0]).toEqual([items.map(item => item.key)]);

    await wrapper.findAllComponents({ name: 'Select' })[0].setValue('temporary');
    await button('导出选中').trigger('click');
    expect(wrapper.emitted('export-items')?.[1]).toEqual([['temporary:2']]);
  });

  it('加载中、处理中及空列表不能导出，处理时显示进度', async () => {
    mountPanel();
    await wrapper.setProps({ loading: true });
    expect(button('批量导出').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ loading: false, busy: true, exportProgress: { phase: 'images', completed: 1, total: 4 } });
    expect(button('批量导出').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('正在处理图片 1 / 4');
    await wrapper.setProps({ exportProgress: { phase: 'archive', completed: 4, total: 4 } });
    expect(wrapper.text()).toContain('正在打包 ZIP');
    await wrapper.setProps({ busy: false, exportProgress: null, items: [] });
    expect(button('批量导出').attributes('disabled')).toBeDefined();
  });
});
