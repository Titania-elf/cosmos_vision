import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import {
  closeInlineImageLightbox,
  inlineLightboxState,
  openInlineImageGalleryLightbox,
  openInlineImageLightbox,
  type InlineLightboxBatch,
  type InlineLightboxGallery,
  type InlinePromptSnapshot,
} from '@/composables/inlineImageLightbox';
import InlineImageLightbox from '@/panel/components/InlineImageLightbox.vue';

const snapshot: InlinePromptSnapshot = {
  positivePrompt: '1girl, masterpiece',
  negativePrompt: 'lowres',
};

let currentWrapper: ReturnType<typeof mount> | null = null;

/**
 * 挂载灯箱组件（含 Pinia 与 Teleport 处理）
 */
function mountLightbox() {
  currentWrapper?.unmount();
  currentWrapper = mount(InlineImageLightbox, {
    global: {
      stubs: { teleport: true },
    },
  });
  return currentWrapper;
}

describe('InlineImageLightbox 组件', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    closeInlineImageLightbox();
  });

  afterEach(async () => {
    currentWrapper?.unmount();
    currentWrapper = null;
    closeInlineImageLightbox();
    await nextTick();
    vi.restoreAllMocks();
  });

  it('关闭状态不渲染灯箱内容', () => {
    const wrapper = mountLightbox();
    expect(wrapper.find('.cv-lightbox-overlay').exists()).toBe(false);
  });

  it('打开后渲染图片与缩放按钮', async () => {
    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('https://example.com/a.png');
    expect(wrapper.findAll('.p-gallery-action')).toHaveLength(2);
  });

  it('点击关闭按钮后状态置为关闭', async () => {
    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    await wrapper.vm.$nextTick();

    await wrapper.find('.cv-lightbox-close').trigger('click');
    expect(inlineLightboxState.open).toBe(false);
  });

  it('复制按钮调用剪贴板写入', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    await wrapper.vm.$nextTick();

    // 面板默认折叠，先展开再点击正面提示词复制按钮
    await wrapper.find('.cv-lightbox-toggle-btn').trigger('click');
    const copyBtns = wrapper.findAll('.cv-lightbox-copy-btn');
    await copyBtns[0].trigger('click');

    expect(writeText).toHaveBeenCalledWith('1girl, masterpiece');
  });

  it('zoom 按钮初始态：zoom-out 禁用、zoom-in 可用', async () => {
    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    await wrapper.vm.$nextTick();

    const actions = wrapper.findAll('.p-gallery-action');
    const zoomIn = actions.find(a => a.attributes('data-action') === 'zoom-in')!;
    const zoomOut = actions.find(a => a.attributes('data-action') === 'zoom-out')!;

    expect(zoomIn.attributes('disabled')).toBeUndefined();
    expect(zoomOut.attributes('disabled')).toBeDefined();
  });

  it('ComfyUI 新快照（无顶层字段）正确从 comfyui 子对象回显提示词', async () => {
    const modernSnapshot: InlinePromptSnapshot = {
      imageSource: 'comfyui',
      comfyui: {
        endpoint: 'http://127.0.0.1:8188',
        positivePrompt: 'comfyui modern positive',
        negativePrompt: 'comfyui modern negative',
        imageOutputNodeId: '9',
        promptBindings: [],
        seedValues: [],
        imageBindings: [],
        loras: [],
      },
    };

    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', modernSnapshot);
    await wrapper.vm.$nextTick();

    await wrapper.find('.cv-lightbox-toggle-btn').trigger('click');
    const promptContents = wrapper.findAll('.cv-lightbox-prompt-content');
    expect(promptContents[0].text()).toBe('comfyui modern positive');
    expect(promptContents[1].text()).toBe('comfyui modern negative');
  });

  it('点击图片信息按钮切换元数据面板显隐，重新打开灯箱时重置为隐藏', async () => {
    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    await wrapper.vm.$nextTick();

    const infoBtn = wrapper.find('.cv-lightbox-info-toggle');
    expect(infoBtn.exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(false);

    await infoBtn.trigger('click');
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(true);
    expect(infoBtn.classes()).toContain('active');

    await infoBtn.trigger('click');
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(false);
    expect(infoBtn.classes()).not.toContain('active');

    // 重新打开灯箱重置为隐藏
    await infoBtn.trigger('click');
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(true);
    closeInlineImageLightbox();
    await wrapper.vm.$nextTick();
    openInlineImageLightbox('https://example.com/b.png', snapshot);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(false);
  });

  it('信息面板展开时按 ESC 优先关闭面板，面板已关闭时按 ESC 关闭灯箱', async () => {    const wrapper = mountLightbox();
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    await wrapper.vm.$nextTick();

    // 展开信息面板
    await wrapper.find('.cv-lightbox-info-toggle').trigger('click');
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(true);

    // 首次按 ESC：仅关闭信息面板，灯箱保持开启
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'LightboxImageInfoPanel' }).exists()).toBe(false);
    expect(inlineLightboxState.open).toBe(true);

    // 再次按 ESC：关闭灯箱
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.open).toBe(false);
  });
});

/** 构造测试用图片池 */
function createGallery(keys: string[]): InlineLightboxGallery {
  return {
    keys: () => keys,
    srcOf: key => `blob:${key}`,
    snapshotOf: key => ({ ...snapshot, positivePrompt: `prompt-${key}` }),
    downloadOf: () => undefined,
    ensure: vi.fn(),
  };
}

/** 构造测试用批量上下文 */
function createBatch(overrides: Partial<InlineLightboxBatch> = {}): InlineLightboxBatch {
  return {
    action: 'download',
    count: 1,
    disabled: false,
    isSelected: () => false,
    toggle: vi.fn(),
    execute: vi.fn(),
    ...overrides,
  };
}

describe('InlineImageLightbox 大图翻页与批量勾选', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    closeInlineImageLightbox();
  });

  afterEach(async () => {
    currentWrapper?.unmount();
    currentWrapper = null;
    closeInlineImageLightbox();
    await nextTick();
    vi.restoreAllMocks();
  });

  it('按图片池打开时显示序号，点击左右按钮循环翻页并同步提示词', async () => {
    const gallery = createGallery(['a', 'b', 'c']);
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(gallery, 'a');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').attributes('src')).toBe('blob:a');
    expect(wrapper.find('.cv-lightbox-nav-counter').text()).toBe('1 / 3');
    await wrapper.find('.cv-lightbox-toggle-btn').trigger('click');
    expect(wrapper.findAll('.cv-lightbox-prompt-content')[0].text()).toBe('prompt-a');

    const next = wrapper.find('.cv-lightbox-arrow--next');
    const prev = wrapper.find('.cv-lightbox-arrow--prev');
    await next.trigger('click');
    expect(inlineLightboxState.key).toBe('b');
    expect(wrapper.find('img').attributes('src')).toBe('blob:b');
    expect(wrapper.findAll('.cv-lightbox-prompt-content')[0].text()).toBe('prompt-b');

    await prev.trigger('click');
    expect(inlineLightboxState.key).toBe('a');
    // 首尾循环：从第一张继续往前翻到末张
    await prev.trigger('click');
    expect(inlineLightboxState.key).toBe('c');
    expect(wrapper.find('.cv-lightbox-nav-counter').text()).toBe('3 / 3');
    expect(gallery.ensure).toHaveBeenCalledWith('b');
  });

  it('方向键翻页，批量处理中禁用翻页按钮且忽略方向键', async () => {
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a', {
      batch: createBatch({ disabled: true }),
    });
    await wrapper.vm.$nextTick();

    expect(
      wrapper.findAll('.cv-lightbox-arrow').every(button => button.attributes('disabled') !== undefined),
    ).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('a');

    closeInlineImageLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a');
    await wrapper.vm.$nextTick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('b');
  });

  it('勾选当前图片时回调调用方，并展示已选数量与对应操作', async () => {
    const count = ref(0);
    const batch: InlineLightboxBatch = {
      ...createBatch(),
      get count() {
        return count.value;
      },
    };
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a', { batch });
    await wrapper.vm.$nextTick();

    const execButton = wrapper.find('.cv-lightbox-batch-exec');
    expect(execButton.text()).toContain('下载选中（0）');
    expect(execButton.attributes('disabled')).toBeDefined();

    await wrapper.find('.cv-lightbox-select input').trigger('change');
    expect(batch.toggle).toHaveBeenCalledWith('a');

    count.value = 2;
    await wrapper.vm.$nextTick();
    expect(execButton.text()).toContain('下载选中（2）');
    expect(execButton.attributes('disabled')).toBeUndefined();
  });

  it('执行批量操作先关闭灯箱再交给调用方', async () => {
    const batch = createBatch({ action: 'delete', count: 2 });
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a', { batch });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.cv-lightbox-batch-exec').text()).toContain('删除选中（2）');
    await wrapper.find('.cv-lightbox-batch-exec').trigger('click');
    expect(inlineLightboxState.open).toBe(false);
    expect(batch.execute).toHaveBeenCalledTimes(1);
  });

  it('手机端单指左右滑动切换，纵向滑动不切换', async () => {
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b', 'c']), 'a');
    await wrapper.vm.$nextTick();
    const box = wrapper.find('.cv-lightbox-img-box').element;

    dispatchTouch(box, 'touchstart', [{ x: 300, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 200, y: 205 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('b');

    dispatchTouch(box, 'touchstart', [{ x: 200, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 300, y: 198 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('a');

    dispatchTouch(box, 'touchstart', [{ x: 300, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 260, y: 400 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('a');

    // 阈值不足的轻微滑动不切换
    dispatchTouch(box, 'touchstart', [{ x: 300, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 275, y: 200 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('a');
  });

  it('滑动松手后补发的 click 被吞掉，不会误触缩放', async () => {
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a');
    await wrapper.vm.$nextTick();
    const gallery = wrapper.findComponent({ name: 'Gallery' });
    const emitSpy = vi.spyOn(gallery.vm, '$emit');
    const box = wrapper.find('.cv-lightbox-img-box').element;

    dispatchTouch(box, 'touchstart', [{ x: 300, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 180, y: 200 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('b');

    box.querySelector('img')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emitSpy).not.toHaveBeenCalledWith('zoom-change', expect.anything());
  });

  it('图片放大后滑动用于平移，不切换图片', async () => {
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a');
    await wrapper.vm.$nextTick();
    wrapper.findComponent({ name: 'Gallery' }).vm.$emit('zoom-change', 3);
    await wrapper.vm.$nextTick();

    const box = wrapper.find('.cv-lightbox-img-box').element;
    dispatchTouch(box, 'touchstart', [{ x: 300, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 150, y: 200 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('a');
  });

  it('批量处理中禁止滑动翻页', async () => {
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(createGallery(['a', 'b']), 'a', { batch: createBatch({ disabled: true }) });
    await wrapper.vm.$nextTick();

    const box = wrapper.find('.cv-lightbox-img-box').element;
    dispatchTouch(box, 'touchstart', [{ x: 300, y: 200 }]);
    dispatchTouch(box, 'touchend', [{ x: 150, y: 200 }]);
    await wrapper.vm.$nextTick();
    expect(inlineLightboxState.key).toBe('a');
  });

  it('图片池中当前图未加载完成时展示加载态，加载完成后显示图片', async () => {
    const keys = ['a'];
    const srcs = ref<Record<string, string>>({});
    const gallery: InlineLightboxGallery = {
      keys: () => keys,
      srcOf: key => srcs.value[key] ?? '',
      snapshotOf: () => snapshot,
      downloadOf: () => undefined,
      ensure: vi.fn(),
    };
    const wrapper = mountLightbox();
    openInlineImageGalleryLightbox(gallery, 'a');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('.cv-lightbox-img-loading').text()).toBe('图片加载中…');

    srcs.value = { a: 'blob:a' };
    await wrapper.vm.$nextTick();
    expect(wrapper.find('img').attributes('src')).toBe('blob:a');
  });
});

/** 派发模拟触摸事件（jsdom 无 TouchEvent，用属性注入的 Event 代替） */
function dispatchTouch(target: Element, type: string, touches: { x: number; y: number }[]): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const points = touches.map(touch => ({ clientX: touch.x, clientY: touch.y }));
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : points });
  Object.defineProperty(event, 'changedTouches', { value: points });
  target.dispatchEvent(event);
}
