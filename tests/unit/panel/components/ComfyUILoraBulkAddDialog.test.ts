import { mount } from '@vue/test-utils';
import InputText from 'primevue/inputtext';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';

import type { ComfyUILoraSetting } from '@/constants/comfyui';
import ComfyUILoraBulkAddDialog from '@/panel/components/comfyui/ComfyUILoraBulkAddDialog.vue';
import ComfyUILoraOptionThumb from '@/panel/components/comfyui/ComfyUILoraOptionThumb.vue';

const COMFYUI_URL = 'http://127.0.0.1:8188';

/** 预览图接口桩：按 LoRA 名称返回同源相对地址，模拟 LoRA Manager 命中 */
const fetchComfyUILoraPreviewUrl = vi.fn(async (comfyuiUrl: string, loraName: string) =>
  `${comfyuiUrl}/api/lm/previews?path=${encodeURIComponent(loraName)}`,
);

vi.mock('@/services/comfyui/lora-preview', () => ({
  fetchComfyUILoraPreviewUrl: (comfyuiUrl: string, loraName: string) => fetchComfyUILoraPreviewUrl(comfyuiUrl, loraName),
}));

/**
 * IntersectionObserver 桩：jsdom 未实现该 API，这里让观察到的元素立即视为进入视口，
 * 以便断言缩略图的懒加载链路（进入视口 → 请求预览图 → 渲染 img）。
 */
class ImmediateIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
      this,
    );
  }

  unobserve(): void {}

  disconnect(): void {}

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);

const OPTIONS = [
  { value: 'char/hero.safetensors', label: 'char/hero.safetensors' },
  { value: 'style/ink.safetensors', label: 'style/ink.safetensors' },
];

/**
 * 构造预设组已有条目
 * @param name LoRA 名称
 * @returns LoRA 条目
 */
function existingLora(name: string): ComfyUILoraSetting {
  return { id: `id-${name}`, name, strength: 0.8, enabled: true };
}

/** 已挂载包装器：弹窗会往 window 挂 scroll 监听，测试间必须显式卸载避免串扰 */
const mountedWrappers: ReturnType<typeof mount>[] = [];

afterEach(() => {
  mountedWrappers.splice(0).forEach(wrapper => wrapper.unmount());
});

/**
 * 挂载批量添加弹窗（内容经 Teleport 渲染到 body）
 * @param props 覆盖属性
 * @returns 挂载后的包装器
 */
function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = mount(ComfyUILoraBulkAddDialog, {
    props: {
      visible: true,
      comfyuiUrl: COMFYUI_URL,
      options: OPTIONS,
      existingLoras: [],
      ...props,
    },
    attachTo: document.body,
    global: {
      plugins: [PrimeVue],
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('ComfyUILoraBulkAddDialog 预览图', () => {
  it('每个候选 LoRA 都带缩略图，且透传 ComfyUI 地址与 LoRA 名称', async () => {
    const wrapper = mountDialog();
    await nextTick();

    const thumbs = wrapper.findAllComponents(ComfyUILoraOptionThumb);
    expect(thumbs).toHaveLength(OPTIONS.length);
    expect(thumbs.map(thumb => thumb.props('loraName'))).toEqual(OPTIONS.map(option => option.value));
    expect(thumbs.every(thumb => thumb.props('comfyuiUrl') === COMFYUI_URL)).toBe(true);
    // 缩略图是装饰性的：名称已作为行内文本提供，避免读屏重复朗读
    expect(thumbs.every(thumb => thumb.attributes('aria-hidden') === 'true')).toBe(true);
  });

  it('缩略图进入视口后按 LoRA 名称拉取并展示预览图', async () => {
    mountDialog();
    await nextTick();

    await vi.waitFor(() => {
      const srcs = [...document.body.querySelectorAll('img')].map(img => img.getAttribute('src'));
      expect(srcs).toEqual(
        OPTIONS.map(option => `${COMFYUI_URL}/api/lm/previews?path=${encodeURIComponent(option.value)}`),
      );
    });
    expect(fetchComfyUILoraPreviewUrl).toHaveBeenCalledWith(COMFYUI_URL, OPTIONS[0].value);
  });

  it('已添加的条目同样展示缩略图，但不可勾选', async () => {
    mountDialog({ existingLoras: [existingLora(OPTIONS[0].value)] });
    await nextTick();

    // Dialog 内容经 Teleport 渲染到 body，故按文档查询而非 wrapper.find
    const rows = [...document.body.querySelectorAll('label')];
    expect(rows).toHaveLength(OPTIONS.length);
    await vi.waitFor(() => {
      expect(document.body.querySelectorAll('img')).toHaveLength(OPTIONS.length);
    });

    const addedRow = rows.find(row => row.textContent?.includes('已添加'));
    expect(addedRow).toBeDefined();
    expect(addedRow?.className).toContain('pointer-events-none');
    expect(addedRow?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
  });

  it('搜索过滤后仅保留匹配项，缩略图数量随之收敛', async () => {
    const wrapper = mountDialog();
    await nextTick();

    await wrapper.findComponent(InputText).setValue('ink');
    await nextTick();

    const thumbs = wrapper.findAllComponents(ComfyUILoraOptionThumb);
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]?.props('loraName')).toBe(OPTIONS[1].value);
  });
});

describe('ComfyUILoraBulkAddDialog 勾选命中层', () => {
  it('命中层用铺满整行的透明 input 承载勾选语义', async () => {
    mountDialog();
    await nextTick();

    const input = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    // 不再用 sr-only：ST 的 input[type='checkbox'] 特异性更高，会把 sr-only 的几何顶掉，
    // 留下被 clip-path 裁成退化矩形的流内元素，聚焦时触发滚动补偿把弹窗顶起
    expect(input?.classList.contains('cv-lora-bulk-check-input')).toBe(true);
    expect(input?.classList.contains('sr-only')).toBe(false);
    // input 的定位上下文必须是行本身，聚焦矩形才等于行
    expect(input?.closest('label')?.className).toContain('relative');
  });

  it('点击行双向切换勾选状态', async () => {
    const wrapper = mountDialog();
    await nextTick();

    const input = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    input.click();
    await nextTick();
    expect(document.body.textContent).toContain('已选 1 个');

    input.click();
    await nextTick();
    expect(document.body.textContent).toContain('已选 0 个');

    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});

describe('ComfyUILoraBulkAddDialog 页面滚动兜底', () => {
  it('弹窗打开期间页面被滚动时立刻还原', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    mountDialog();
    await nextTick();

    // 模拟浏览器聚焦隐藏控件时的滚动补偿
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('弹窗关闭后停止监听页面滚动', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const wrapper = mountDialog();
    await nextTick();

    await wrapper.setProps({ visible: false });
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    window.dispatchEvent(new Event('scroll'));

    expect(scrollTo).not.toHaveBeenCalled();
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
