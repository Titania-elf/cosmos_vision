/** 参与活性检查的挂载最小形状 */
export interface MountLivenessMount {
  element: HTMLElement;
}

/** 参与活性检查的楼层 runtime 最小形状 */
export interface MountLivenessRuntime {
  message_id: number;
  mounts: readonly MountLivenessMount[];
}

/** 挂载活性观察器选项 */
export interface MountLivenessObserverOptions {
  /** 读取观察根（通常 #chat）；返回空时退回 document.body */
  resolveRoot: () => Element | null;
  /** 收集当前疑似被打散的楼层号 */
  collectDetachedFloors: () => number[];
  /** 静默窗口结束后回调被打散的楼层号 */
  onDetached: (messageIds: number[]) => void;
  /** 合并连续 DOM 变动的静默窗口毫秒数 */
  settleMs?: number;
}

/** 挂载活性观察器句柄 */
export interface MountLivenessObserver {
  disconnect: () => void;
}

/** 默认静默窗口：合并一次整块 innerHTML 重写引发的连续变动 */
const DEFAULT_SETTLE_MS = 350;

/**
 * 收集「楼层仍在 DOM 中、但挂载容器已被外部重写打散」的楼层号
 *
 * 有些扩展会调用 ST 的 updateMessageBlock 或直接给 .mes_text 赋 innerHTML 来整块重绘消息，
 * 这条路径不派发任何 ST 事件，寄生在 .mes_text 里的 cv-render 会被连根移除而无人知晓。
 * 楼层本身已不在 DOM（翻页裁掉、已删除）不算被打散，那种情况交给 audit 处理。
 * @param runtimes 当前楼层 runtime 列表
 * @param findMessageElement 按楼层号读取 #chat 下的 .mes 元素
 * @returns 被打散的楼层号（保持 runtime 顺序）
 */
export function collectDetachedMountFloors(
  runtimes: readonly MountLivenessRuntime[],
  findMessageElement: (messageId: number) => Element | null,
): number[] {
  const detached: number[] = [];
  for (const runtime of runtimes) {
    if (!runtime.mounts.length) continue;
    if (!findMessageElement(runtime.message_id)) continue;
    if (runtime.mounts.some(mount => !mount.element.isConnected)) detached.push(runtime.message_id);
  }
  return detached;
}

/**
 * 创建挂载活性观察器
 *
 * 观察根下出现变动后在静默窗口结束时复查一次；窗口内的后续变动只做合并，
 * 不推迟复查，避免流式输出这类持续变动把复查永远压住。
 * @param options 观察器选项
 * @returns 观察器控制句柄
 */
export function createMountLivenessObserver(options: MountLivenessObserverOptions): MountLivenessObserver {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** 加入静默窗口；已在窗口内则合并本次变动 */
  function scheduleCheck(): void {
    if (timer !== null) return;
    timer = setTimeout(runCheck, settleMs);
  }

  /** 复查并上报被打散的楼层 */
  function runCheck(): void {
    timer = null;
    const messageIds = options.collectDetachedFloors();
    if (messageIds.length) options.onDetached(messageIds);
  }

  const root = options.resolveRoot() ?? document.body;
  if (root) {
    observer = new MutationObserver(scheduleCheck);
    observer.observe(root, { childList: true, subtree: true });
  }

  return {
    disconnect: () => {
      observer?.disconnect();
      observer = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
