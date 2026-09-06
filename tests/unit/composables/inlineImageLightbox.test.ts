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

/** 读取当前图片容器 */
function queryImgBox(): HTMLElement {
  return document.querySelector<HTMLElement>('.cv-lightbox-img-box')!;
}

/** 构造指针事件（jsdom 无 PointerEvent，用 MouseEvent 伪造） */
function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  opts: { pointerId?: number; clientX?: number; clientY?: number } = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: opts.pointerId ?? 1 });
  return event;
}

/** 模拟一次双指张开放大 */
function pinchZoomIn(imgBox: HTMLElement): void {
  imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 150, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: 250, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 100, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: 300, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 300, clientY: 100 }));
}

/** 构造触摸事件（jsdom 无 TouchEvent，用 Event 伪造 touches） */
function touchEvent(type: 'touchstart' | 'touchend', x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touch = { clientX: x, clientY: y };
  Object.defineProperty(event, 'touches', { value: [touch] });
  Object.defineProperty(event, 'changedTouches', { value: [touch] });
  return event;
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
    const entries = [buildEntry('a', 'blob:a'), buildEntry('b', 'blob:b'), buildEntry('c', 'blob:c')];
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

describe('openInlineImageLightbox 大图缩放', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('双指张开放大当前图片，切换条目时重置缩放', async () => {
    const entries = [buildEntry('a', 'blob:a'), buildEntry('b', 'blob:b')];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 0 } });

    const imgBox = queryImgBox();
    pinchZoomIn(imgBox);
    expect(queryImage().style.transform).toContain('scale(2)');

    (queryOverlay().querySelector('.cv-lightbox-nav-next') as HTMLElement).click();
    await flushMicrotasks();

    expect(queryImage().src).toContain('blob:b');
    expect(queryImage().style.transform).toBe('');
  });

  it('放大状态下横向滑动不切换画廊条目', async () => {
    const entries = [buildEntry('a', 'blob:a'), buildEntry('b', 'blob:b')];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 0 } });

    const imgBox = queryImgBox();
    pinchZoomIn(imgBox);

    imgBox.dispatchEvent(touchEvent('touchstart', 300, 100));
    imgBox.dispatchEvent(touchEvent('touchend', 80, 100));
    await flushMicrotasks();

    expect(queryImage().src).toContain('blob:a');
    expect(queryOverlay().querySelector('.cv-lightbox-counter')!.textContent).toBe('1 / 2');
  });

  it('未放大时横向滑动仍切换画廊条目', async () => {
    const entries = [buildEntry('a', 'blob:a'), buildEntry('b', 'blob:b')];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 0 } });

    const imgBox = queryImgBox();
    imgBox.dispatchEvent(touchEvent('touchstart', 300, 100));
    imgBox.dispatchEvent(touchEvent('touchend', 80, 100));
    await flushMicrotasks();

    expect(queryImage().src).toContain('blob:b');
  });

  it('PC 拖动图片松开后不关闭灯箱，平移位置保留', () => {
    const onClose = vi.fn();
    const entries = [buildEntry('a', 'blob:a')];
    openInlineImageLightbox('blob:a', undefined, { gallery: { entries, index: 0 }, onClose });

    const imgBox = queryImgBox();
    pinchZoomIn(imgBox);
    imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, clientX: 100, clientY: 100 }));
    imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, clientX: 300, clientY: 100 }));
    imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 3, clientX: 300, clientY: 100 }));
    const pannedTransform = queryImage().style.transform;
    expect(pannedTransform).toContain('scale(2)');

    // 松开时浏览器在按下/抬起目标的公共祖先上合成 click，不应触发背景关闭
    imgBox.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 100 }));

    expect(onClose).not.toHaveBeenCalled();
    expect(queryImage().style.transform).toBe(pannedTransform);
  });

  it('无位移的点击图片容器空白处仍关闭灯箱', () => {
    const onClose = vi.fn();
    openInlineImageLightbox('blob:solo', buildSnapshot('solo'), { onClose });

    const imgBox = queryImgBox();
    imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 50, clientY: 50 }));
    imgBox.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 52, clientY: 51 }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
