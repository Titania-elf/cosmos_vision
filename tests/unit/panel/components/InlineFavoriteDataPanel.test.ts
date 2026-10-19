import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, ref } from 'vue';
import InlineFavoriteDataPanel from '@/panel/components/InlineFavoriteDataPanel.vue';
import type { ManagedImageItem } from '@/services/inline-image/managed-images';

const lightboxCache = vi.hoisted(() => ({ urlOf: vi.fn(() => ''), ensure: vi.fn() }));

vi.mock('@/composables/useManagedImagePreviews', () => ({
  useManagedImagePreviews: () => ({ previewUrls: ref({}), previewStatus: () => 'ready' }),
  useLightboxImageCache: () => lightboxCache,
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

const PopoverStub = defineComponent({
  setup(_, { expose }) {
    const visible = ref(false);
    expose({
      toggle: () => {
        visible.value = !visible.value;
      },
      hide: () => {
        visible.value = false;
      },
    });
    return { visible };
  },
  template: '<div v-if="visible"><slot /></div>',
});

const CvDataCardStub = defineComponent({
  name: 'CvDataCard',
  props: ['selected', 'selecting', 'disabled'],
  emits: ['toggle'],
  template: '<div><slot /></div>',
});

let wrapper: VueWrapper;
function mountPanel() {
  wrapper = shallowMount(InlineFavoriteDataPanel, {
    props: { items, loading: false, busy: false },
    global: {
      stubs: {
        StaticPanel: { template: '<section><slot name="actions" /><slot /></section>' },
        CvMiniButton: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}</button>' },
        CvDataCard: CvDataCardStub,
        Popover: PopoverStub,
      },
    },
  });
  return wrapper;
}

function button(label: string) {
  return wrapper.findAll('button').find(button => button.text() === label)!;
}

afterEach(() => wrapper?.unmount());

async function startBatch(label: '批量下载' | '批量删除') {
  await button('批量操作').trigger('click');
  await button(label).trigger('click');
}

describe('图片管理批量操作', () => {
  it('先选择操作再勾选图片，点击入口或选择下载均不立即下载全部图片', async () => {
    mountPanel();
    expect(button('批量下载')).toBeUndefined();
    expect(button('批量删除')).toBeUndefined();
    await button('批量操作').trigger('click');
    expect(wrapper.text()).toContain('请选择批量操作');
    expect(wrapper.findComponent({ name: 'CvDataCard' }).props('selecting')).toBe(false);
    expect(wrapper.emitted('download-items')).toBeUndefined();
    expect(wrapper.emitted('delete-items')).toBeUndefined();

    await button('批量下载').trigger('click');
    expect(button('批量删除')).toBeUndefined();
    expect(button('删除选中')).toBeUndefined();
    expect(button('下载选中').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('download-items')).toBeUndefined();
    const card = wrapper.findComponent({ name: 'CvDataCard' });
    expect(card.props('selecting')).toBe(true);
    card.vm.$emit('toggle');
    await wrapper.vm.$nextTick();
    await button('下载选中').trigger('click');
    expect(wrapper.emitted('download-items')).toEqual([[['favorite:1']]]);
    expect(wrapper.emitted('delete-items')).toBeUndefined();
  });

  it('类型、角色、聊天筛选共同限定全选下载范围', async () => {
    mountPanel();
    const filters = wrapper.findAllComponents({ name: 'Select' });
    await filters[0].setValue('favorite');
    await filters[1].setValue('Alice');
    await filters[2].setValue('Alice::chat-1');
    expect(wrapper.text()).toContain('当前筛选 1 张');
    await startBatch('批量下载');
    await button('全选').trigger('click');
    await button('下载选中').trigger('click');
    expect(wrapper.emitted('download-items')).toEqual([[['favorite:1']]]);
  });

  it('全选覆盖未渲染图片，缩小筛选范围后不下载隐藏的已选项', async () => {
    mountPanel();
    await startBatch('批量下载');
    await button('全选').trigger('click');
    await button('下载选中').trigger('click');
    expect(wrapper.emitted('download-items')?.[0]).toEqual([items.map(item => item.key)]);

    await wrapper.findAllComponents({ name: 'Select' })[0].setValue('temporary');
    await button('下载选中').trigger('click');
    expect(wrapper.emitted('download-items')?.[1]).toEqual([['temporary:2']]);
  });

  it('取消后改选删除不沿用下载选择，删除模式只提供删除操作', async () => {
    mountPanel();
    await startBatch('批量下载');
    await button('全选').trigger('click');
    await button('取消批量').trigger('click');
    await startBatch('批量删除');
    expect(wrapper.text()).toContain('已选 0 张');
    expect(button('下载选中')).toBeUndefined();
    expect(button('删除选中').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('delete-items')).toBeUndefined();
    await button('全选').trigger('click');
    await button('删除选中').trigger('click');
    expect(wrapper.emitted('delete-items')).toEqual([[items.map(item => item.key)]]);
    expect(wrapper.emitted('download-items')).toBeUndefined();
    await button('取消').trigger('click');
    expect(button('删除选中')).toBeUndefined();
  });

  it('数据清空后退出批量模式，恢复数据时不会保留旧选择', async () => {
    mountPanel();
    await startBatch('批量删除');
    await button('全选').trigger('click');
    await wrapper.setProps({ items: [] });
    expect(button('批量操作').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ items });
    await startBatch('批量下载');
    expect(wrapper.text()).toContain('已选 0 张');
  });

  it('加载中、处理中及空列表不能开始批量操作，处理时显示进度', async () => {
    mountPanel();
    await wrapper.setProps({ loading: true });
    expect(button('批量操作').attributes('disabled')).toBeDefined();
    await wrapper.setProps({ loading: false, busy: true, exportProgress: { phase: 'images', completed: 1, total: 4 } });
    expect(button('批量操作').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('正在处理图片 1 / 4');
    await wrapper.setProps({ exportProgress: { phase: 'archive', completed: 4, total: 4 } });
    expect(wrapper.text()).toContain('正在打包 ZIP');
    await wrapper.setProps({ busy: false, exportProgress: null, items: [] });
    expect(button('批量操作').attributes('disabled')).toBeDefined();
  });

  it('执行中锁定批量按钮、已选图片和筛选条件', async () => {
    mountPanel();
    await startBatch('批量下载');
    await button('全选').trigger('click');
    await wrapper.setProps({ busy: true });
    for (const label of ['取消批量', '取消全选', '下载选中', '取消']) {
      expect(button(label).attributes('disabled')).toBeDefined();
    }
    // Select 的继承属性在 shallow stub 中通过 attrs 透传。
    for (const filter of wrapper.findAllComponents({ name: 'Select' })) {
      expect(filter.attributes('disabled')).toBe('true');
    }
    wrapper.findComponent({ name: 'CvDataCard' }).vm.$emit('toggle');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('已选 4 张');
  });
});

describe('图片管理大图图片池', () => {
  it('缩略图始终可进大图，并携带当前筛选顺序的图片池', async () => {
    mountPanel();
    const image = wrapper.findComponent({ name: 'LightboxImage' });
    expect(image.props('disabled')).toBe(false);

    const gallery = image.props('gallery');
    expect(gallery).toBeTruthy();
    expect(gallery.keys()).toEqual(items.map(item => item.key));
    expect(gallery.snapshotOf('favorite:1')).toEqual(items[0].promptSnapshot);
    expect(gallery.downloadOf('favorite:1')).toBeTypeOf('function');

    gallery.ensure('favorite:1');
    await wrapper.vm.$nextTick();
  });

  it('未进入批量模式时大图不带勾选上下文，进入后与列表共享选择', async () => {
    mountPanel();
    expect(wrapper.findComponent({ name: 'LightboxImage' }).props('batch')).toBeNull();

    await startBatch('批量删除');
    const batch = wrapper.findComponent({ name: 'LightboxImage' }).props('batch');
    expect(batch.action).toBe('delete');
    expect(batch.count).toBe(0);

    batch.toggle('favorite:1');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('已选 1 张');
    expect(batch.isSelected('favorite:1')).toBe(true);

    batch.execute();
    expect(wrapper.emitted('delete-items')).toEqual([[['favorite:1']]]);
  });

  it('筛选变化后图片池只包含当前可见顺序的图片', async () => {
    mountPanel();
    await wrapper.findAllComponents({ name: 'Select' })[0].setValue('temporary');
    const gallery = wrapper.findComponent({ name: 'LightboxImage' }).props('gallery');
    expect(gallery.keys()).toEqual(['temporary:2']);
  });
});
