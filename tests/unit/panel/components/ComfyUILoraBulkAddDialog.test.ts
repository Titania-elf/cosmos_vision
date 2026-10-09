import { mount } from '@vue/test-utils';
import InputText from 'primevue/inputtext';
import PrimeVue from 'primevue/config';
import { describe, expect, it, vi } from 'vitest';
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

/**
 * 挂载批量添加弹窗（内容经 Teleport 渲染到 body）
 * @param props 覆盖属性
 * @returns 挂载后的包装器
 */
function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ComfyUILoraBulkAddDialog, {
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
