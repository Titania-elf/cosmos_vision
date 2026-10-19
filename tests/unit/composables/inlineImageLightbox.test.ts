import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cloneInlinePromptSnapshot,
  closeInlineImageLightbox,
  handleInlineImageClick,
  inlineLightboxState,
  openInlineImageGalleryLightbox,
  openInlineImageLightbox,
  type InlineLightboxBatch,
  type InlineLightboxGallery,
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

  it('openInlineImageGalleryLightbox 写入图片池、初始 key 与批量上下文，并请求加载初始图片', () => {
    const gallery = createGallery(['a', 'b']);
    const batch = createBatch();
    openInlineImageGalleryLightbox(gallery, 'b', { batch });

    expect(inlineLightboxState.open).toBe(true);
    expect(inlineLightboxState.key).toBe('b');
    expect(inlineLightboxState.src).toBe('blob:b');
    expect(inlineLightboxState.snapshot).toEqual(gallery.snapshotOf('b'));
    expect(inlineLightboxState.batch).toEqual(batch);
    expect(gallery.ensure).toHaveBeenCalledWith('b');
  });

  it('不传批量上下文时大图只支持预览，且不残留上一张的单张下载回调', () => {
    openInlineImageLightbox('https://example.com/a.png', snapshot, { onDownload: vi.fn() });
    openInlineImageGalleryLightbox(createGallery(['a']), 'a');

    expect(inlineLightboxState.batch).toBeUndefined();
    expect(inlineLightboxState.onDownload).toBeUndefined();
  });

  it('单图模式重新打开时清空图片池状态，避免沿用旧图片列表', () => {
    openInlineImageGalleryLightbox(createGallery(['a']), 'a', { batch: createBatch() });
    openInlineImageLightbox('https://example.com/a.png', snapshot);

    expect(inlineLightboxState.key).toBe('');
    expect(inlineLightboxState.gallery).toBeUndefined();
    expect(inlineLightboxState.batch).toBeUndefined();
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
function createBatch(): InlineLightboxBatch {
  return {
    action: 'download',
    count: 2,
    disabled: false,
    isSelected: () => false,
    toggle: vi.fn(),
    execute: vi.fn(),
  };
}

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

describe('cloneInlinePromptSnapshot', () => {
  it('带顶层快照克隆保留', () => {
    const legacySnapshot: InlinePromptSnapshot = {
      positivePrompt: '1girl, masterpiece',
      negativePrompt: 'lowres, bad quality',
      imageSource: 'novelai',
    };
    const cloned = cloneInlinePromptSnapshot(legacySnapshot);

    expect(cloned.positivePrompt).toBe('1girl, masterpiece');
    expect(cloned.negativePrompt).toBe('lowres, bad quality');
    expect(cloned.imageSource).toBe('novelai');
  });

  it('顶层空串克隆原样保留（不因 truthy 判断丢弃）', () => {
    const emptySnapshot: InlinePromptSnapshot = {
      positivePrompt: '',
      negativePrompt: '',
      imageSource: 'comfyui',
    };
    const cloned = cloneInlinePromptSnapshot(emptySnapshot);

    expect(cloned.positivePrompt).toBe('');
    expect(cloned.negativePrompt).toBe('');
    expect('positivePrompt' in cloned).toBe(true);
  });

  it('无顶层快照克隆后仍无顶层（不补空串）', () => {
    const modernSnapshot: InlinePromptSnapshot = {
      imageSource: 'comfyui',
      comfyui: {
        endpoint: 'http://127.0.0.1:8188',
        positivePrompt: 'comfyui positive',
        negativePrompt: 'comfyui negative',
        imageOutputNodeId: '9',
        promptBindings: [],
        seedValues: [],
        loras: [],
      },
    };
    const cloned = cloneInlinePromptSnapshot(modernSnapshot);

    expect(cloned.positivePrompt).toBeUndefined();
    expect(cloned.negativePrompt).toBeUndefined();
    expect('positivePrompt' in cloned).toBe(false);
    expect('negativePrompt' in cloned).toBe(false);
    expect(cloned.comfyui?.positivePrompt).toBe('comfyui positive');
  });

  it('克隆 novelaiRequest 独立对象，旧快照无该字段时输出无该字段', () => {
    const withoutRequest: InlinePromptSnapshot = {
      imageSource: 'novelai',
      positivePrompt: 'pos',
    };
    const clonedWithout = cloneInlinePromptSnapshot(withoutRequest);
    expect('novelaiRequest' in clonedWithout).toBe(false);
    expect(clonedWithout.novelaiRequest).toBeUndefined();

    const withRequest: InlinePromptSnapshot = {
      imageSource: 'novelai',
      positivePrompt: 'pos',
      novelaiRequest: {
        endpoint: 'https://image.novelai.net',
        accountName: '测试账号',
        model: 'nai-diffusion-4-full',
        width: 832,
        height: 1216,
        sampler: 'k_euler',
        seed: 123456,
        steps: 28,
        guidance: 6,
        autoSampler: true,
        varietyPlus: false,
        smea: false,
        smeaDyn: false,
        decrisp: false,
        legacyPromptMode: false,
        promptGuidanceRescale: 0,
        noiseSchedule: 'karras',
        ucPreset: 'Heavy',
        qualityPreset: 'Standard',
        imageCount: 1,
        vibes: { count: 0, referenceStrengths: [], informationExtracted: [], resolved: true },
      },
    };
    const clonedWith = cloneInlinePromptSnapshot(withRequest);
    expect(clonedWith.novelaiRequest).toEqual(withRequest.novelaiRequest);
    expect(clonedWith.novelaiRequest).not.toBe(withRequest.novelaiRequest);
  });
});

