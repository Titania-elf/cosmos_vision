import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openInlineImageLightbox,
  type InlineLightboxGalleryEntry,
  type InlinePromptSnapshot,
} from '@/composables/inlineImageLightbox';

vi.mock('@/store/settings', () => ({
  useSettingsStore: () => ({ darkMode: false }),
}));

/** 构造提示词快照 */
function buildSnapshot(positive: string): InlinePromptSnapshot {
  return { positivePrompt: positive, negativePrompt: '' };
}

/** 构造画廊条目 */
function buildEntry(id: string, src: string | (() => string | Promise<string>)): InlineLightboxGalleryEntry {
  return { src, snapshot: buildSnapshot(`prompt-${id}`) };
}

/** 读取当前灯箱根元素 */
function queryOverlay(): HTMLElement {
  return document.querySelector<HTMLElement>('.cv-lightbox-overlay')!;
}

/** 读取当前大图 */
function queryImage(): HTMLImageElement {
  return document.querySelector<HTMLImageElement>('.cv-lightbox-preview-img')!;
}

/** 刷新微任务队列，让懒加载 src 解析完成 */
function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('openInlineImageLightbox 画廊切换', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('多图画廊渲染切换按钮与计数，点击下一张切换图片与提示词', async () => {
    const entries = [
      buildEntry('a', 'blob:a'),
      buildEntry('b', 'blob:b'),
      buildEntry('c', 'blob:c'),
    ];
    openInlineImageLightbox('blob:a', entries[0]!.snapshot, {
      gallery: { entries, index: 0 },
    });

    const overlay = queryOverlay();
    expect(overlay.querySelector('.cv-lightbox-nav-prev')).toBeTruthy();
    expect(overlay.querySelector('.cv-lightbox-nav-next')).toBeTruthy();
    expect(overlay.querySelector('.cv-lightbox-counter')!.textContent).toBe('1 / 3');
    expect(queryImage().src).toContain('blob:a');
    // 初始条目提示词已渲染
    expect(overlay.innerHTML).toContain('prompt-a');

    (overlay.querySelector('.cv-lightbox-nav-next') as HTMLElement).click();
    await flushMicrotasks();

    expect(queryImage().src).toContain('blob:b');
    expect(overlay.querySelector('.cv-lightbox-counter')!.textContent).toBe('2 / 3');
    expect(overlay.innerHTML).toContain('prompt-b');
  });

  it('边界序号禁用对应方向按钮', () => {
    const entries = [buildEntry('a', 'blob:a'), buildEntry('b', 'blob:b')];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 1 } });

    const overlay = queryOverlay();
    const prev = overlay.querySelector<HTMLButtonElement>('.cv-lightbox-nav-prev')!;
    const next = overlay.querySelector<HTMLButtonElement>('.cv-lightbox-nav-next')!;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    expect(overlay.querySelector('.cv-lightbox-counter')!.textContent).toBe('2 / 2');
  });

  it('方向键左右切换，懒加载 src 仅在切到该条目时解析', async () => {
    const lazySrc = vi.fn(() => 'blob:lazy');
    const entries = [buildEntry('a', 'blob:a'), buildEntry('lazy', lazySrc)];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 0 } });

    expect(lazySrc).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await flushMicrotasks();

    expect(lazySrc).toHaveBeenCalledTimes(1);
    expect(queryImage().src).toContain('blob:lazy');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await flushMicrotasks();

    expect(queryImage().src).toContain('blob:a');
  });

  it('关闭灯箱时触发 onClose 回调', async () => {
    const onClose = vi.fn();
    const entries = [buildEntry('a', 'blob:a'), buildEntry('b', 'blob:b')];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 0 }, onClose });

    (queryOverlay().querySelector('.cv-lightbox-close') as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('单图模式不渲染切换 UI', () => {
    openInlineImageLightbox('blob:solo', buildSnapshot('solo'));
    const overlay = queryOverlay();
    expect(overlay.querySelector('.cv-lightbox-nav-prev')).toBeNull();
    expect(overlay.querySelector('.cv-lightbox-counter')).toBeNull();
    expect(queryImage().src).toContain('blob:solo');
  });
});
