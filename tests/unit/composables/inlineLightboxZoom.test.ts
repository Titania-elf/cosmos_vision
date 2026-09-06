import { beforeEach, describe, expect, it } from 'vitest';
import { createLightboxZoom } from '@/composables/inlineLightboxZoom';

/** 构造带图片的灯箱容器并挂载 */
function mountImgBox(): { imgBox: HTMLElement; img: HTMLImageElement } {
  document.body.innerHTML = '';
  const imgBox = document.createElement('div');
  imgBox.className = 'cv-lightbox-img-box';
  const img = document.createElement('img');
  img.className = 'cv-lightbox-preview-img';
  img.src = 'blob:test';
  imgBox.appendChild(img);
  document.body.appendChild(imgBox);
  return { imgBox, img };
}

/** 构造指针事件（jsdom 无 PointerEvent，用 MouseEvent 伪造） */
function pointerEvent(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
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

/** 模拟一次双指捏合（两指从 from 间距捏合/张开到 to 间距，中点不变） */
function pinch(imgBox: HTMLElement, from: number, to: number): void {
  const mid = 200;
  imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: mid - from / 2, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 2, clientX: mid + from / 2, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: mid - to / 2, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: mid + to / 2, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: mid - to / 2, clientY: 100 }));
  imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: mid + to / 2, clientY: 100 }));
}

/** 模拟一次点按 */
function tap(imgBox: HTMLElement, x: number, y: number): void {
  imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: x, clientY: y }));
  imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: y }));
}

/** 给图片与容器注入非零尺寸，让平移限幅可观测 */
function stubSizes(imgBox: HTMLElement, img: HTMLImageElement): void {
  imgBox.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect;
  Object.defineProperty(img, 'offsetWidth', { value: 800, configurable: true });
  Object.defineProperty(img, 'offsetHeight', { value: 600, configurable: true });
}

describe('createLightboxZoom', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('双指张开放大到对应倍率并标记放大态', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);
    pinch(imgBox, 100, 200);

    expect(img.style.transform).toContain('scale(2)');
    expect(img.classList.contains('cv-lightbox-img-zoomed')).toBe(true);
    expect(zoom.isZoomed()).toBe(true);
    zoom.destroy();
  });

  it('双指捏合回初始间距时还原为未放大态', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);
    pinch(imgBox, 100, 200);
    pinch(imgBox, 200, 100);

    expect(img.style.transform).toBe('');
    expect(zoom.isZoomed()).toBe(false);
    zoom.destroy();
  });

  it('放大后单指拖拽平移图片', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);
    stubSizes(imgBox, img);
    pinch(imgBox, 100, 200);

    imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3, clientX: 100, clientY: 100 }));
    imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 3, clientX: 220, clientY: 130 }));
    imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 3, clientX: 220, clientY: 130 }));

    // 捏合后基准为 translate(200px, 200px) scale(2)，拖拽 (120, 30) 后叠加
    expect(img.style.transform).toContain('translate(320px, 230px)');
    expect(img.style.transform).toContain('scale(2)');
    zoom.destroy();
  });

  it('未放大时单指滑动不产生平移也不消费触摸', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);
    stubSizes(imgBox, img);

    imgBox.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }));
    imgBox.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 260, clientY: 100 }));
    imgBox.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 260, clientY: 100 }));

    expect(img.style.transform).toBe('');
    expect(zoom.isTouchConsumed()).toBe(false);
    zoom.destroy();
  });

  it('双击放大到固定倍率，再次双击还原', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);

    tap(imgBox, 100, 100);
    tap(imgBox, 110, 105);
    expect(img.style.transform).toContain('scale(2.5)');
    expect(zoom.isZoomed()).toBe(true);

    tap(imgBox, 108, 103);
    tap(imgBox, 112, 107);
    expect(img.style.transform).toBe('');
    expect(zoom.isZoomed()).toBe(false);
    zoom.destroy();
  });

  it('PC 滚轮放大与缩小', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);

    imgBox.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }));
    expect(img.style.transform).toContain('scale(1.2)');

    imgBox.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, clientX: 400, clientY: 300, cancelable: true }));
    expect(img.style.transform).toBe('');
    zoom.destroy();
  });

  it('reset 清除放大状态与手势标记', () => {
    const { imgBox, img } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);
    pinch(imgBox, 100, 300);

    zoom.reset();

    expect(img.style.transform).toBe('');
    expect(img.classList.contains('cv-lightbox-img-zoomed')).toBe(false);
    expect(zoom.isZoomed()).toBe(false);
    expect(zoom.isTouchConsumed()).toBe(false);
    zoom.destroy();
  });

  it('捏合手势后触摸被消费，抑制画廊滑动切换', () => {
    const { imgBox } = mountImgBox();
    const zoom = createLightboxZoom(imgBox);
    pinch(imgBox, 100, 150);

    expect(zoom.isTouchConsumed()).toBe(true);
    zoom.destroy();
  });

  it('缺少图片元素时返回空控制器', () => {
    document.body.innerHTML = '';
    const imgBox = document.createElement('div');
    document.body.appendChild(imgBox);
    const zoom = createLightboxZoom(imgBox);

    expect(zoom.isZoomed()).toBe(false);
    expect(() => zoom.reset()).not.toThrow();
    expect(() => zoom.destroy()).not.toThrow();
  });
});
