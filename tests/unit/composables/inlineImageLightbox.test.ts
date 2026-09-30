import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cloneInlinePromptSnapshot,
  closeInlineImageLightbox,
  handleInlineImageClick,
  inlineLightboxState,
  openInlineImageLightbox,
  type InlinePromptSnapshot,
} from '@/composables/inlineImageLightbox';

const snapshot: InlinePromptSnapshot = {
  positivePrompt: '1girl',
  negativePrompt: 'lowres',
};

describe('cloneInlinePromptSnapshot', () => {
  it('保留按节点分组的 LoRA 方案，回放时才能各写各的 LoRA 节点', () => {
    const cloned = cloneInlinePromptSnapshot({
      positivePrompt: '1girl',
      negativePrompt: 'lowres',
      imageSource: 'comfyui',
      comfyui: {
        endpoint: 'http://127.0.0.1:8188',
        positivePrompt: '1girl',
        negativePrompt: 'lowres',
        imageOutputNodeId: '9',
        promptBindings: [],
        seedValues: [],
        loras: [{ name: 'stage1', strength: 0.7 }],
        loraNodes: [
          { nodeId: '56', loras: [{ name: 'stage1', strength: 0.7 }] },
          { nodeId: '71', loras: [] },
        ],
      },
    });

    expect(cloned.comfyui?.loras).toEqual([{ name: 'stage1', strength: 0.7 }]);
    expect(cloned.comfyui?.loraNodes).toEqual([
      { nodeId: '56', loras: [{ name: 'stage1', strength: 0.7 }] },
      { nodeId: '71', loras: [] },
    ]);
  });

  it('旧快照没有分组字段时克隆结果也不带该字段', () => {
    const cloned = cloneInlinePromptSnapshot({
      positivePrompt: '1girl',
      negativePrompt: 'lowres',
      imageSource: 'comfyui',
      comfyui: {
        endpoint: 'http://127.0.0.1:8188',
        positivePrompt: '1girl',
        negativePrompt: 'lowres',
        imageOutputNodeId: '9',
        promptBindings: [],
        seedValues: [],
        loras: [{ name: 'legacy', strength: 1 }],
      },
    });

    expect(cloned.comfyui?.loraNodes).toBeUndefined();
  });
});

describe('inlineImageLightbox 状态', () => {
  beforeEach(() => {
    closeInlineImageLightbox();
  });

  it('openInlineImageLightbox 正确写入状态字段', () => {
    const onDownload = vi.fn();
    openInlineImageLightbox('https://example.com/a.png', snapshot, { onDownload });

    expect(inlineLightboxState.open).toBe(true);
    expect(inlineLightboxState.src).toBe('https://example.com/a.png');
    expect(inlineLightboxState.snapshot).toEqual(snapshot);
    expect(inlineLightboxState.onDownload).toBe(onDownload);
  });

  it('closeInlineImageLightbox 置 open 为 false', () => {
    openInlineImageLightbox('https://example.com/a.png', snapshot);
    expect(inlineLightboxState.open).toBe(true);

    closeInlineImageLightbox();
    expect(inlineLightboxState.open).toBe(false);
  });
});

describe('handleInlineImageClick', () => {
  beforeEach(() => {
    closeInlineImageLightbox();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('运行时未启用时不打开灯箱', () => {
    const wrap = document.createElement('div');
    const img = document.createElement('img');

    handleInlineImageClick(new MouseEvent('click'), img, wrap, () => false, snapshot);

    expect(inlineLightboxState.open).toBe(false);
  });

  it('PC 端点击直接打开灯箱', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    const wrap = document.createElement('div');
    const img = document.createElement('img');

    handleInlineImageClick(new MouseEvent('click'), img, wrap, () => true, snapshot);

    expect(inlineLightboxState.open).toBe(true);
    expect(inlineLightboxState.src).toBe(img.src);
  });

  it('移动端首次点击仅激活容器，第二次点击打开灯箱', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const wrap = document.createElement('div');
    const img = document.createElement('img');

    handleInlineImageClick(new MouseEvent('click'), img, wrap, () => true, snapshot);
    expect(wrap.classList.contains('cv-inline-img-active')).toBe(true);
    expect(inlineLightboxState.open).toBe(false);

    handleInlineImageClick(new MouseEvent('click'), img, wrap, () => true, snapshot);
    expect(inlineLightboxState.open).toBe(true);
    expect(wrap.classList.contains('cv-inline-img-active')).toBe(false);
  });
});
