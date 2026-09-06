/**
 * 内联灯箱大图缩放控制器
 *
 * 基于指针事件实现（挂载到 `.cv-lightbox-img-box`）：
 * - 移动端：双指捏合缩放 / 放大后单指拖拽平移 / 双击切换放大
 * - PC 端：滚轮缩放 / 双击切换放大 / 放大后拖拽平移
 *
 * 变换模型：`translate(tx, ty) scale(s)`（transform-origin 默认居中），
 * 图片未变换时居中于 img-box，因此元素中心 = img-box 中心；
 * 屏幕坐标 p 与图片坐标 q 满足 p = t + q * s。
 */

/** 最小缩放倍率（初始状态） */
const MIN_SCALE = 1;
/** 最大缩放倍率 */
const MAX_SCALE = 8;
/** 双击切换的目标倍率 */
const DOUBLE_TAP_SCALE = 2.5;
/** 双击判定时间窗口（毫秒） */
const DOUBLE_TAP_INTERVAL = 300;
/** 双击两次落点最大间距（像素） */
const DOUBLE_TAP_MAX_DISTANCE = 48;
/** 单指平移启动的位移阈值（像素） */
const PAN_START_THRESHOLD = 6;
/** 每次滚轮缩放的倍率步长 */
const WHEEL_ZOOM_STEP = 1.2;

/** 判定为放大态的倍率 epsilon（浮点容差） */
const ZOOMED_EPSILON = 0.001;

/** 灯箱缩放控制器 */
export interface InlineLightboxZoomController {
  /** 当前是否处于放大状态 */
  isZoomed(): boolean;
  /** 最近一次手势是否消费了触摸（捏合或放大态平移），用于抑制画廊滑动切换 */
  isTouchConsumed(): boolean;
  /** 重置到初始状态（切换画廊条目时调用） */
  reset(): void;
  /** 解绑所有监听（关闭灯箱时调用） */
  destroy(): void;
}

interface PointerPoint {
  x: number;
  y: number;
}

/** 捏合手势基准（以手势起始时的变换为参照） */
interface PinchBase {
  dist: number;
  scale: number;
  tx: number;
  ty: number;
}

/** 单指平移手势基准 */
interface PanBase extends PointerPoint {
  tx: number;
  ty: number;
}

/**
 * 创建灯箱缩放控制器
 * @param imgBox 图片容器（`.cv-lightbox-img-box`）
 * @returns 缩放控制器（缺少图片元素时返回空实现）
 */
export function createLightboxZoom(imgBox: HTMLElement): InlineLightboxZoomController {
  const img = imgBox.querySelector<HTMLImageElement>('.cv-lightbox-preview-img');
  if (!img) return createNoopZoomController();

  let scale = MIN_SCALE;
  let translateX = 0;
  let translateY = 0;
  /** 当前参与手势的活跃指针（pointerId → 最新位置） */
  const pointers = new Map<number, PointerPoint>();
  let pinchBase: PinchBase | null = null;
  let panBase: PanBase | null = null;
  let downPoint: PointerPoint | null = null;
  let moved = false;
  /** 手势是否消费了触摸（捏合或放大态平移），抑制 touchend 触发画廊滑动切换 */
  let touchConsumed = false;
  let lastTap: { time: number; x: number; y: number } | null = null;

  /**
   * 读取当前双指捏合的间距与中点
   * @returns 有效双指时返回指标，否则 null
   */
  const getPinchMetrics = (): { dist: number; mid: PointerPoint } | null => {
    const [a, b] = [...pointers.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  /**
   * 围绕指定屏幕锚点缩放（保持锚点下的图片内容不动）
   * @param point 屏幕锚点
   * @param nextScale 目标倍率
   * @param base 以该基准变换计算（捏合手势传入起始态，其余传当前态）
   */
  const zoomAround = (point: PointerPoint, nextScale: number, base?: PinchBase): void => {
    const box = imgBox.getBoundingClientRect();
    const origin = base ?? { dist: 0, scale, tx: translateX, ty: translateY };
    // 锚点相对未变换图片中心（= img-box 中心）的偏移
    const px = point.x - (box.left + box.width / 2);
    const py = point.y - (box.top + box.height / 2);
    // 反解锚点在图片坐标系中的位置：q = (p - t) / s
    const qx = (px - origin.tx) / origin.scale;
    const qy = (py - origin.ty) / origin.scale;
    scale = nextScale;
    translateX = px - qx * nextScale;
    translateY = py - qy * nextScale;
    clampTranslate();
    applyTransform();
  };

  /**
   * 直接切换到目标倍率（不指定锚点，回到居中）
   * @param nextScale 目标倍率
   */
  const zoomToScale = (nextScale: number): void => {
    scale = clampScale(nextScale);
    translateX = 0;
    translateY = 0;
    applyTransform();
  };

  /**
   * 限制平移范围：图片可视边不超出 img-box
   */
  const clampTranslate = (): void => {
    const box = imgBox.getBoundingClientRect();
    const halfWidth = (img.offsetWidth * scale - box.width) / 2;
    const halfHeight = (img.offsetHeight * scale - box.height) / 2;
    translateX = halfWidth > 0 ? clamp(translateX, -halfWidth, halfWidth) : 0;
    translateY = halfHeight > 0 ? clamp(translateY, -halfHeight, halfHeight) : 0;
  };

  /**
   * 应用变换到图片元素（回到初始态时清除行内样式）
   */
  const applyTransform = (): void => {
    const isReset = scale <= MIN_SCALE && translateX === 0 && translateY === 0;
    if (isReset) {
      scale = MIN_SCALE;
      translateX = 0;
      translateY = 0;
      img.style.transform = '';
    } else {
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }
    img.classList.toggle('cv-lightbox-img-zoomed', !isReset);
  };

  /**
   * 处理单次点按：与上一次点按构成双击时切换放大状态
   * @param e 指针抬起事件
   */
  const handleTap = (e: PointerEvent): void => {
    const now = performance.now();
    const isDoubleTap =
      lastTap !== null &&
      now - lastTap.time <= DOUBLE_TAP_INTERVAL &&
      Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DOUBLE_TAP_MAX_DISTANCE;
    lastTap = { time: now, x: e.clientX, y: e.clientY };
    if (!isDoubleTap) return;
    lastTap = null;
    if (scale > MIN_SCALE) {
      zoomToScale(MIN_SCALE);
    } else {
      zoomAround({ x: e.clientX, y: e.clientY }, DOUBLE_TAP_SCALE);
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downPoint = { x: e.clientX, y: e.clientY };
    moved = false;
    touchConsumed = false;
    if (pointers.size === 2) {
      const metrics = getPinchMetrics();
      if (metrics && metrics.dist > 0) {
        pinchBase = { dist: metrics.dist, scale, tx: translateX, ty: translateY };
      }
      touchConsumed = true;
      img.classList.add('cv-lightbox-img-dragging');
    } else if (pointers.size === 1) {
      panBase = { x: e.clientX, y: e.clientY, tx: translateX, ty: translateY };
      if (scale > MIN_SCALE) img.classList.add('cv-lightbox-img-dragging');
    }
    // 捕获指针，移出容器仍可收到 move/up（jsdom 无此方法，忽略）
    try {
      imgBox.setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const metrics = getPinchMetrics();
      if (!metrics || !pinchBase || pinchBase.dist <= 0) return;
      const nextScale = clampScale(pinchBase.scale * (metrics.dist / pinchBase.dist));
      zoomAround(metrics.mid, nextScale, pinchBase);
      return;
    }
    if (downPoint && Math.hypot(e.clientX - downPoint.x, e.clientY - downPoint.y) > PAN_START_THRESHOLD) {
      moved = true;
    }
    // 未放大时不平移，保留原生滚动与画廊滑动手势
    if (!moved || !panBase || scale <= MIN_SCALE) return;
    touchConsumed = true;
    translateX = panBase.tx + (e.clientX - panBase.x);
    translateY = panBase.ty + (e.clientY - panBase.y);
    clampTranslate();
    applyTransform();
  };

  const onPointerUp = (e: PointerEvent) => {
    const wasPinch = pointers.size >= 2;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      // 双指抬起一只：以剩余手指重建平移基准，继续单指平移
      const [remaining] = [...pointers.values()];
      if (remaining) {
        panBase = { x: remaining.x, y: remaining.y, tx: translateX, ty: translateY };
        downPoint = { x: remaining.x, y: remaining.y };
        moved = true;
      }
      pinchBase = null;
    } else if (pointers.size === 0) {
      pinchBase = null;
      panBase = null;
      downPoint = null;
      img.classList.remove('cv-lightbox-img-dragging');
      if (!wasPinch && !moved) handleTap(e);
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    const nextScale = clampScale(scale * factor);
    if (nextScale === scale) return;
    zoomAround({ x: e.clientX, y: e.clientY }, nextScale);
  };

  /** 重置到初始状态（切换画廊条目时调用） */
  const reset = (): void => {
    pointers.clear();
    pinchBase = null;
    panBase = null;
    downPoint = null;
    moved = false;
    touchConsumed = false;
    zoomToScale(MIN_SCALE);
    img.classList.remove('cv-lightbox-img-dragging');
  };

  /** 解绑所有监听（关闭灯箱时调用） */
  const destroy = (): void => {
    reset();
    imgBox.removeEventListener('pointerdown', onPointerDown);
    imgBox.removeEventListener('pointermove', onPointerMove);
    imgBox.removeEventListener('pointerup', onPointerUp);
    imgBox.removeEventListener('pointercancel', onPointerUp);
    imgBox.removeEventListener('wheel', onWheel);
  };

  imgBox.addEventListener('pointerdown', onPointerDown);
  imgBox.addEventListener('pointermove', onPointerMove);
  imgBox.addEventListener('pointerup', onPointerUp);
  imgBox.addEventListener('pointercancel', onPointerUp);
  imgBox.addEventListener('wheel', onWheel, { passive: false });

  return {
    isZoomed: () => scale > MIN_SCALE + ZOOMED_EPSILON,
    isTouchConsumed: () => touchConsumed || scale > MIN_SCALE + ZOOMED_EPSILON,
    reset,
    destroy,
  };
}

/**
 * 构造空控制器（缺少图片元素时兜底）
 * @returns 不执行任何操作的控制器
 */
function createNoopZoomController(): InlineLightboxZoomController {
  return {
    isZoomed: () => false,
    isTouchConsumed: () => false,
    reset: () => {},
    destroy: () => {},
  };
}

/**
 * 数值限幅
 * @param value 原值
 * @param min 下限
 * @param max 上限
 * @returns 限幅后的值
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 缩放倍率限幅
 * @param value 原倍率
 * @returns 限幅后的倍率
 */
function clampScale(value: number): number {
  return clamp(value, MIN_SCALE, MAX_SCALE);
}
