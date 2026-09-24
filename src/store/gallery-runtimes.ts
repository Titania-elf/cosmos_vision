import { uuidv4 } from '@sillytavern/scripts/utils';
import {
  pickGalleryMounts,
  pickMountFromFloorTailSession,
  pickMountFromSession,
  type GalleryMountSpec,
} from '@/services/inline-image/slot-gallery-pick';
import {
  appendGeneratedSessionItem,
  clearAllGallerySessions,
  createSessionItemId,
  persistGallerySessionItem,
  removeSessionItemsByIds,
  restoreGallerySessions,
  type GallerySessionItem,
  type GallerySessionRecord,
} from '@/composables/inlineGallerySession';
import type { InlineGeneratedImageResult } from '@/composables/inlineImageGeneratedResult';
import type { FreshPromptMode } from '@/composables/inlineGenerationInput';
import {
  ensureSlotRenderContainerForParagraph,
  findRenderContainerAfter,
  removeRenderContainer,
} from '@/services/inline-image/cv-render-container';
import { getCurrentInlineFavoriteScope } from '@/services/sillytavern/chat-context';
import { ensureSlotShortcodeOnParagraph, resolveParagraphSlotId } from '@/services/inline-image/slot-bind';
import { newSlotId, parseSlotIds, removeSlotShortcode } from '@/services/inline-image/slot-shortcode';
import { readChatMessageRaw, writeChatMessageRaw } from '@/services/inline-image/message-raw';
import {
  isSlotBindingCleanupEmpty,
  planSlotBindingCleanup,
  summarizeSlotBindingCleanup,
  type OrphanShortcodeRef,
  type SlotBindingCleanupSummary,
} from '@/services/inline-image/orphan-slots';
import { listInlineImageFavoriteMeta, type InlineImageFavoriteScope } from '@/services/inline-image/favorites-cache';
import type { InlineFavoriteAnchor } from '@/services/sillytavern/chat-dom';
import { chat, event_types, eventSource } from '@sillytavern/script';
import { useSettingsStore } from '@/store/settings';
import { deleteTemporaryImage, listTemporaryImages, pruneTemporaryImages } from '@/services/inline-image/temporary-images';
import { pruneFloorTailSlotsAboveMesId } from '@/services/inline-image/floor-tail-slot';

/** 失效绑定码清理确认回调：返回 true 才落地清理 */
export type SlotBindingCleanupConfirm = (
  summary: SlotBindingCleanupSummary,
) => boolean | Promise<boolean>;

/** 失效绑定码清理结果 */
export interface SlotBindingCleanupResult extends SlotBindingCleanupSummary {
  /** 是否真正落地清理 */
  applied: boolean;
  /** 未落地原因 */
  reason: 'applied' | 'cancelled' | 'nothing' | 'no-scope';
}

/** 渲染器回调（命令式 DOM 渲染器注册；避免 store↔渲染器循环依赖） */
let notifySlotChange: ((slotId: string) => void) | null = null;
let clearRenderedGalleries: (() => void) | null = null;

/**
 * 注册命令式渲染器的数据变化通知回调
 * @param notifier 通知函数
 */
export function registerGalleryRendererCallbacks(notifier: (slotId: string) => void, clear: () => void): void {
  notifySlotChange = notifier;
  clearRenderedGalleries = clear;
}

/**
 * 广播 slot 数据变化（生图/收藏/删除/淘汰路径统一入口）
 * @param slotId 位点 id
 */
function notifyGalleryChanged(slotId: string): void {
  notifySlotChange?.(slotId);
}

/** 管理页类型互换后的画廊就地补丁（保留 objectUrl，避免闪烁） */
export type GalleryKindPatch =
  | {
      to: 'favorite';
      temporaryId: string;
      favoriteId: number;
      createdAt: number;
    }
  | {
      to: 'temporary';
      favoriteId: number;
      temporaryId: string;
      createdAt: number;
    };

/** 单画廊 mount 运行时 */
export interface GalleryMountRuntime {
  key: string;
  messageId: number;
  element: HTMLElement;
  mountKey: GalleryMountSpec['mountKey'];
  anchor: InlineFavoriteAnchor;
  generatedItem: GallerySessionItem | null;
  /** 类型互换就地补丁 */
  kindPatch: GalleryKindPatch | null;
}

/** 楼层粒度 runtime */
export interface GalleryMessageRuntime {
  message_id: number;
  reload_memo: string;
  mounts: GalleryMountRuntime[];
}

export type { InlineGeneratedImageResult };

/** 楼层尾画廊动作恢复上下文 */
export interface GalleryGenerationContext {
  targetIframeId?: string;
  targetIframeIndex?: number;
}

interface GalleryRuntimeHandlers {
  onGenerateWithSnapshot: (
    paragraph: HTMLElement,
    snapshot: GallerySessionItem['promptSnapshot'],
    context?: GalleryGenerationContext,
  ) => Promise<void>;
  onGenerateWithFreshPrompt: (paragraph: HTMLElement, mode: FreshPromptMode, context?: GalleryGenerationContext) => Promise<void>;
  onGenerateWithEditablePrompt: (
    paragraph: HTMLElement,
    snapshot: GallerySessionItem['promptSnapshot'],
    context?: GalleryGenerationContext,
  ) => Promise<void>;
  onDownloadImage: (imageBlob: Blob, createdAt: number) => Promise<void>;
}

type PendingJob =
  | { kind: 'audit' }
  | { kind: 'rerenderAll'; clearSessions: boolean }
  | { kind: 'floor'; messageId: number };

/**
 * 段落画廊 runtime store：扫短码 / temp → cv-render → Teleport
 * 异步任务串行防重入
 */
export const useGalleryRuntimesStore = defineStore('cosmos_vision_gallery_runtimes', () => {
  const settingsStore = useSettingsStore();
  const runtimes = ref<GalleryMessageRuntime[]>([]);
  const themeToken = ref(0);
  let handlers: GalleryRuntimeHandlers | null = null;
  /** 是否已完成当前聊天的 IDB 临时图片恢复（防止楼层事件惰性清理误删 slot） */
  let sessionRestored = false;
  let disposed = false;
  let started = false;
  let chain: Promise<void> = Promise.resolve();
  const floorTailAnchors = new Map<string, HTMLElement>();

  const onChatLoaded = () => scheduleRestore();
  const onMoreMessages = () => scheduleJob({ kind: 'audit' });
  const onMessageDeleted = (data?: unknown) => {
    // ST 的 MESSAGE_DELETED emit 的是删除后的 chat.length，非被删 mesId
    // 删除后剩余 mesId 为 [0, chat.length) 连续区间，超出上界的 slot 均已失效
    const threshold = normalizeMessageId(data);
    if (threshold !== null) {
      const deletedSlots = pruneFloorTailSlotsAboveMesId(threshold);
      for (const slot of deletedSlots) {
        floorTailAnchors.delete(slot.slotId);
        for (const imgId of slot.imageRefs) {
          void deleteTemporaryImage(imgId);
        }
      }
    }
    scheduleJob({ kind: 'audit' });
  };
  const onMessageFloor = (messageId: unknown) => {
    const id = normalizeMessageId(messageId);
    if (id === null) return;
    scheduleJob({ kind: 'floor', messageId: id });
  };

  watch(
    () => settingsStore.savedSettings.enabled,
    enabled => {
      if (!started || disposed) return;
      if (enabled) scheduleJob({ kind: 'rerenderAll', clearSessions: false });
      else clearRuntimesOnly();
    },
  );

  watch(
    () => settingsStore.savedSettings.temporaryImageLimit,
    limit => {
      if (!started || disposed) return;
      void pruneTemporaryImages(limit)
        .then(removedIds => {
          removeSessionItemsByIds(removedIds);
          scheduleJob(removedIds.length ? { kind: 'rerenderAll', clearSessions: false } : { kind: 'audit' });
        })
        .catch(error => {
          console.error('[CosmosVision] 临时图片数量清理失败', error);
          toastr.error('临时图片数量清理失败');
        });
    },
  );

  /**
   * 注入生成/下载回调
   * @param next 回调集合
   */
  function setHandlers(next: GalleryRuntimeHandlers): void {
    handlers = next;
  }

  /**
   * 读取动作回调
   * @returns handlers 或 null
   */
  function getActionHandlers(): GalleryRuntimeHandlers | null {
    return handlers;
  }

  /**
   * 保存当前页面内 floor-tail 的真实焦点元素
   * @param slotId floor-tail 位点
   * @param anchor 前端气泡或段落元素
   */
  function setFloorTailAnchor(slotId: string, anchor: HTMLElement): void {
    floorTailAnchors.set(slotId, anchor);
  }

  /**
   * 读取当前页面内 floor-tail 的真实焦点元素
   * @param slotId floor-tail 位点
   * @returns 仍连接在文档中的焦点元素，否则 null
   */
  function getFloorTailAnchor(slotId: string): HTMLElement | null {
    const anchor = floorTailAnchors.get(slotId);
    if (!anchor?.isConnected) {
      floorTailAnchors.delete(slotId);
      return null;
    }
    return anchor;
  }

  /**
   * 删除 floor-tail 的运行时焦点元素
   * @param slotId floor-tail 位点
   */
  function clearFloorTailAnchor(slotId: string): void {
    floorTailAnchors.delete(slotId);
  }

  /**
   * 启动事件监听并首次全量 scan
   */
  function start(): void {
    if (started) return;
    started = true;
    disposed = false;
    bindEvents();
    scheduleRestore();
  }

  /**
   * 清理监听、容器与会话
   */
  function cleanup(): void {
    disposed = true;
    sessionRestored = false;
    started = false;
    unbindEvents();
    clearRenderedGalleries?.();
    removeAllRenderContainers();
    runtimes.value = [];
    clearAllGallerySessions();
    floorTailAnchors.clear();
    handlers = null;
  }

  /**
   * 仅清空运行时 DOM（关插件，保留会话与监听）
   */
  function clearRuntimesOnly(): void {
    clearRenderedGalleries?.();
    removeAllRenderContainers();
    runtimes.value = [];
    floorTailAnchors.clear();
  }

  /**
   * 刷新主题 token
   */
  function refreshTheme(): void {
    themeToken.value += 1;
  }

  /**
   * 全量恢复
   */
  async function restoreAll(): Promise<void> {
    await enqueue(() => runJob({ kind: 'rerenderAll', clearSessions: false }));
  }

  /**
   * 对指定 slot 下发类型互换就地补丁（不拆 DOM、不重建 objectUrl）
   * @param slotId 短码位点
   * @param patch 补丁
   */
  function patchSlotKind(slotId: string, patch: GalleryKindPatch): void {
    if (!slotId || disposed || !settingsStore.savedSettings.enabled) return;
    void patch;
    // 命令式渲染：类型互换直接通知重画（DOM 重画成本可接受，语义一致）
    notifyGalleryChanged(slotId);
  }

  /**
   * 展示新生成的临时图
   * @param paragraph 锚点段落
   * @param result 生成结果
   */
  async function showGenerated(paragraph: HTMLElement, result: InlineGeneratedImageResult): Promise<void> {
    if (disposed || !settingsStore.savedSettings.enabled) return;
    const slotId = resolveParagraphSlotId(paragraph) ?? newSlotId();
    await ensureSlotShortcodeOnParagraph(paragraph, slotId);
    const item: GallerySessionItem = {
      id: createSessionItemId(),
      favoriteId: null,
      slotId,
      imageBlob: result.imageBlob,
      promptSnapshot: result.promptSnapshot,
      createdAt: Date.now(),
    };
    const session = appendGeneratedSessionItem(slotId, item);
    ensureSlotRenderContainerForParagraph(paragraph, slotId);
    upsertSessionMount(session, paragraph);
    // 命令式渲染：数据就绪即通知重画（新图与恢复同一条路）
    notifyGalleryChanged(slotId);
    const scope = getCurrentInlineFavoriteScope();
    if (!scope) {
      console.warn('[CosmosVision] 当前聊天不可用，临时图片仅保留在内存中');
      return;
    }
    void persistGallerySessionItem(session, item, scope, settingsStore.savedSettings.temporaryImageLimit)
      .then(removedIds => removePrunedMounts(removedIds))
      .catch(error => {
        console.error('[CosmosVision] 临时图片持久化失败', error);
        toastr.error('临时图片保存失败');
      });
  }

  /**
   * 展示新生成的前端型楼层尾临时图并返回持久化后的图片 ID
   * @param mesId 消息楼层 ID
   * @param swipeId 当前 swipe ID
   * @param slotId 楼层尾 slotId
   * @param result 生成结果
   * @returns 持久化成功且未被数量限制淘汰时返回图片 ID，否则返回 null
   */
  async function showGeneratedFloorTail(
    mesId: number,
    swipeId: number,
    slotId: string,
    result: InlineGeneratedImageResult,
    targetAnchor?: HTMLElement,
  ): Promise<string | null> {
    if (disposed || !settingsStore.savedSettings.enabled) return null;
    const item: GallerySessionItem = {
      id: createSessionItemId(),
      favoriteId: null,
      slotId,
      imageBlob: result.imageBlob,
      promptSnapshot: result.promptSnapshot,
      createdAt: Date.now(),
    };
    const session = appendGeneratedSessionItem(slotId, item);
    upsertFloorTailSessionMount(session, mesId, swipeId, targetAnchor);
    // 命令式渲染：数据就绪即通知重画
    notifyGalleryChanged(slotId);
    const scope = getCurrentInlineFavoriteScope();
    if (!scope) {
      console.warn('[CosmosVision] 当前聊天不可用，临时图片仅保留在内存中');
      return item.id;
    }
    try {
      const removedIds = await persistGallerySessionItem(session, item, scope, settingsStore.savedSettings.temporaryImageLimit);
      removePrunedMounts(removedIds);
      return removedIds.includes(item.id) ? null : item.id;
    } catch (error) {
      console.error('[CosmosVision] 临时图片持久化失败', error);
      toastr.error('临时图片保存失败');
      return null;
    }
  }

  /** 从 IndexedDB 恢复当前聊天临时图片 */
  function scheduleRestore(): void {
    void enqueue(async () => {
      const scope = getCurrentInlineFavoriteScope();
      sessionRestored = false;
      clearAllGallerySessions();
      await pruneTemporaryImages(settingsStore.savedSettings.temporaryImageLimit);
      if (scope) await restoreGallerySessions(scope);
      sessionRestored = true;
      await runJob({ kind: 'rerenderAll', clearSessions: false });
    });
  }

  /**
   * 移除因数量限制被淘汰的运行时挂载
   * @param removedIds 被淘汰图片 ID
   */
  function removePrunedMounts(removedIds: string[]): void {
    if (!removedIds.length) return;
    scheduleJob({ kind: 'rerenderAll', clearSessions: false });
  }

  /**
   * 读取段落 after 或楼层尾的生成蒙版宿主
   * @param target 段落或楼层元素
   * @returns 宿主容器或 null
   */
  function getHost(target: HTMLElement): HTMLElement | null {
    const container = findRenderContainerAfter(target)
      ?? (target.classList.contains('cv-render') ? target : target.querySelector('.cv-render'));
    if (!container) return null;
    return container.querySelector('.cv-inline-generation-overlay-shell')
      ?? container.querySelector('.cv-inline-img-wrap')
      ?? container;
  }

  /**
   * 绑定 ST 聊天事件
   */
  function bindEvents(): void {
    // 依靠 chatLoaded 事件进行初始化，不监听 CHAT_CHANGED 以防御重复清空问题
    eventSource.makeLast('chatLoaded', onChatLoaded);
    eventSource.makeLast(event_types.MORE_MESSAGES_LOADED, onMoreMessages);
    eventSource.makeLast(event_types.MESSAGE_DELETED, onMessageDeleted);
    for (const event of [
      event_types.CHARACTER_MESSAGE_RENDERED,
      event_types.USER_MESSAGE_RENDERED,
      event_types.MESSAGE_UPDATED,
      event_types.MESSAGE_SWIPED,
    ]) {
      eventSource.makeLast(event, onMessageFloor);
    }
  }

  /**
   * 解除全部事件
   */
  function unbindEvents(): void {
    eventSource.removeListener('chatLoaded', onChatLoaded);
    eventSource.removeListener(event_types.MORE_MESSAGES_LOADED, onMoreMessages);
    eventSource.removeListener(event_types.MESSAGE_DELETED, onMessageDeleted);
    for (const event of [
      event_types.CHARACTER_MESSAGE_RENDERED,
      event_types.USER_MESSAGE_RENDERED,
      event_types.MESSAGE_UPDATED,
      event_types.MESSAGE_SWIPED,
    ]) {
      eventSource.removeListener(event, onMessageFloor);
    }
  }

  /**
   * 把事件任务加入串行队列
   * @param job 待执行工作
   */
  function scheduleJob(job: PendingJob): void {
    if (disposed) return;
    void enqueue(() => runJob(job));
  }

  /**
   * 串行执行异步工作，避免 auditToken 互废
   * @param task 任务
   */
  function enqueue(task: () => Promise<void>): Promise<void> {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 执行合并后的单次 job
   * @param job 合并结果
   */
  async function runJob(job: PendingJob): Promise<void> {
    if (disposed) return;
    if (job.kind === 'rerenderAll') {
      if (job.clearSessions) clearAllGallerySessions();
      await rerenderAll();
      return;
    }
    if (job.kind === 'floor') {
      await applyFloor(job.messageId);
      return;
    }
    await audit();
  }

  /**
   * 增量 audit：保留已有 runtime，补扫未渲染楼层
   */
  async function audit(): Promise<void> {
    if (disposed || !settingsStore.savedSettings.enabled) {
      runtimes.value = [];
      return;
    }
    if (!getCurrentInlineFavoriteScope()) return;
    const toRender = listVisibleMessageIds();
    const keep = runtimes.value.filter(runtime =>
      toRender.includes(runtime.message_id) && isRuntimeLive(runtime),
    );
    const missing = toRender.filter(id => !keep.some(runtime => runtime.message_id === id));
    const added = await buildRuntimes(missing, true);
    if (disposed) return;
    runtimes.value = [...keep, ...added];
  }

  /**
   * 全量重建 runtime 列表
   */
  async function rerenderAll(): Promise<void> {
    if (disposed) return;
    if (!settingsStore.savedSettings.enabled) {
      runtimes.value = [];
      return;
    }
    removeAllRenderContainers();
    runtimes.value = [];
    if (!getCurrentInlineFavoriteScope()) return;
    const added = await buildRuntimes(listVisibleMessageIds(), true);
    if (disposed) return;
    runtimes.value = added;
  }

  /**
   * 重扫单楼（synchronous 串行路径）
   * @param messageId 楼层
   */
  async function applyFloor(messageId: number): Promise<void> {
    if (disposed || !settingsStore.savedSettings.enabled) return;
    // 恢复未完成时，事件驱动的单楼重扫会误判 slot 失效并删除，跳过静待全量恢复
    if (!sessionRestored) return;
    dropFloorRuntime(messageId);
    const built = await buildRuntimes([messageId], sessionRestored);
    if (disposed) return;
    const others = runtimes.value.filter(runtime => runtime.message_id !== messageId);
    runtimes.value = built.length ? [...others, ...built] : others;
  }

  /**
   * 从 runtime 列表剔除某楼（不删会话）
   * @param messageId 楼层
   */
  function dropFloorRuntime(messageId: number): void {
    runtimes.value = runtimes.value.filter(runtime => runtime.message_id !== messageId);
    document
      .querySelectorAll(`#chat > .mes[mesid="${messageId}"] .cv-render`)
      .forEach(removeRenderContainer);
  }

  /**
   * 把生成会话写入 / 更新楼层 runtime
   * @param session 会话
   * @param paragraph 段落
   */
  function upsertSessionMount(session: GallerySessionRecord, paragraph: HTMLElement): void {
    const mount = pickMountFromSession(session, paragraph);
    if (!mount) return;
    const messageId = mount.messageId;
    const existing = runtimes.value.find(runtime => runtime.message_id === messageId);
    if (!existing) {
      runtimes.value = [
        ...runtimes.value,
        {
          message_id: messageId,
          reload_memo: createReloadMemo(),
          mounts: [toMountRuntime(mount)],
        },
      ];
      return;
    }
    const current = existing.mounts.find(item => item.key === mount.key || item.element === mount.element);
    if (current) {
      current.mountKey = mount.mountKey;
      current.anchor = toMountRuntime(mount).anchor;
      current.generatedItem = session.items[0] ?? null;
      return;
    }
    existing.mounts.push(toMountRuntime(mount));
  }

  /**
   * 把前端型生成会话写入 / 更新楼层 runtime
   * @param session 会话
   * @param mesId 消息楼层 ID
   * @param swipeId 当前 swipe ID
   */
  function upsertFloorTailSessionMount(
    session: GallerySessionRecord,
    mesId: number,
    swipeId: number,
    targetAnchor?: HTMLElement,
  ): void {
    const mount = pickMountFromFloorTailSession(session, mesId, swipeId, targetAnchor);
    const existing = runtimes.value.find(runtime => runtime.message_id === mesId);
    if (!existing) {
      runtimes.value = [
        ...runtimes.value,
        {
          message_id: mesId,
          reload_memo: createReloadMemo(),
          mounts: [toMountRuntime(mount)],
        },
      ];
      return;
    }
    const current = existing.mounts.find(item => item.key === mount.key || item.element === mount.element);
    if (current) {
      current.mountKey = mount.mountKey;
      current.anchor = toMountRuntime(mount).anchor;
      current.generatedItem = session.items[0] ?? null;
      return;
    }
    existing.mounts.push(toMountRuntime(mount));
  }

  /**
   * 摘掉空 mount 并可能移除空壳容器
   * @param key mount key
   * @param messageId 楼层
   */
  function removeMount(key: string, messageId: number): void {
    const runtime = runtimes.value.find(item => item.message_id === messageId);
    if (!runtime) return;
    const mount = runtime.mounts.find(item => item.key === key);
    if (mount) clearFloorTailAnchor(mount.mountKey.slotId);
    runtime.mounts = runtime.mounts.filter(item => item.key !== key);
    const orphan = Boolean(mount?.element.isConnected)
      && !runtime.mounts.some(item => item.element === mount?.element);
    if (orphan) {
      const parentRoot = mount?.element.closest('.cv-floor-tail');
      mount?.element.remove();
      if (parentRoot && !parentRoot.children.length) {
        parentRoot.remove();
      }
    }
    if (!runtime.mounts.length) {
      runtimes.value = runtimes.value.filter(item => item.message_id !== messageId);
      return;
    }
    runtime.reload_memo = createReloadMemo();
  }

  /**
   * 一键清除当前聊天的失效绑定码：失效位点短码 + 反向孤儿临时图
   *
   * 挂到与 audit/floor 相同的串行链上执行，确认弹窗期间也占住链，
   * 保证「扫描 → 确认 → 落地」之间不被其它任务插入而读到过期计划。
   * @param confirm 计数确认回调，返回 true 才落地清理
   * @returns 清理结果
   */
  function cleanupOrphanSlotBindings(confirm: SlotBindingCleanupConfirm): Promise<SlotBindingCleanupResult> {
    const job = () => runOrphanSlotBindingCleanup(confirm);
    const run = chain.then(job, job);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 扫描 → 确认 → 落地失效绑定码清理
   * @param confirm 计数确认回调
   * @returns 清理结果
   */
  async function runOrphanSlotBindingCleanup(
    confirm: SlotBindingCleanupConfirm,
  ): Promise<SlotBindingCleanupResult> {
    const scope = getCurrentInlineFavoriteScope();
    if (!scope) {
      return { applied: false, reason: 'no-scope', orphanShortcodeCount: 0, affectedMessageCount: 0, orphanTemporaryImageCount: 0 };
    }
    const { activeReferences, referencedSlotIds } = scanChatSlotReferences();
    const temporaryImages = (await listTemporaryImages(scope)).map(record => ({ id: record.id, slotId: record.slotId }));
    const favoriteSlotIds = await listScopedFavoriteSlotIds(scope);
    const plan = planSlotBindingCleanup({
      activeReferences,
      referencedSlotIds,
      temporaryImages,
      favoriteSlotIds,
      liveSlotIds: collectLiveSlotIds(),
    });
    const summary = summarizeSlotBindingCleanup(plan);
    if (isSlotBindingCleanupEmpty(summary)) return { applied: false, reason: 'nothing', ...summary };
    if (!(await confirm(summary))) return { applied: false, reason: 'cancelled', ...summary };
    await applyOrphanShortcodeRemovals(plan.orphanShortcodes);
    for (const id of plan.orphanTemporaryImageIds) await deleteTemporaryImage(id);
    if (!disposed) await rerenderAll();
    return { applied: true, reason: 'applied', ...summary };
  }

  /**
   * 汇总当前 runtime 与楼层尾锚点占用的 slotId（生成中/已挂载，双向保护）
   * @returns live slotId 集合
   */
  function collectLiveSlotIds(): Set<string> {
    const live = new Set<string>();
    runtimes.value.forEach(runtime => runtime.mounts.forEach(mount => live.add(mount.mountKey.slotId)));
    floorTailAnchors.forEach((_anchor, slotId) => live.add(slotId));
    return live;
  }

  return {
    runtimes,
    themeToken,
    setHandlers,
    getActionHandlers,
    start,
    cleanup,
    refreshTheme,
    restoreAll,
    patchSlotKind,
    setFloorTailAnchor,
    getFloorTailAnchor,
    clearFloorTailAnchor,
    showGenerated,
    showGeneratedFloorTail,
    getHost,
    removeMount,
    cleanupOrphanSlotBindings,
  };
});

/**
 * Runtime 挂载目标是否仍连接在文档
 * @param runtime 楼层 runtime
 * @returns 是否可 keep
 */
function isRuntimeLive(runtime: GalleryMessageRuntime): boolean {
  return runtime.mounts.every(mount => mount.element.isConnected);
}

/**
 * 批量 build 楼层 runtime
 * @param messageIds 楼层集合
 * @returns runtimes
 */
/**
 * 批量 build 楼层 runtime
 * @param messageIds 楼层集合
 * @param sessionRestored 是否已完成 IDB 临时图片恢复（false 时跳过惰性清理删除 slot）
 * @returns runtimes
 */
async function buildRuntimes(
  messageIds: number[],
  sessionRestored: boolean,
): Promise<GalleryMessageRuntime[]> {
  if (!messageIds.length) return [];
  try {
    const mounts = await pickGalleryMounts(messageIds, sessionRestored);
    const byMessage = new Map<number, GalleryMountRuntime[]>();
    for (const mount of mounts) {
      const list = byMessage.get(mount.messageId) ?? [];
      list.push(toMountRuntime(mount));
      byMessage.set(mount.messageId, list);
    }
    return [...byMessage.entries()].map(([message_id, items]) => ({
      message_id,
      reload_memo: createReloadMemo(),
      mounts: items,
    }));
  } catch (error) {
    console.error('[CosmosVision] 扫描画廊 runtime 失败', error);
    toastr.error('读取段落图片收藏失败');
    return [];
  }
}

/**
 * GalleryMountSpec → runtime mount
 * @param mount 挂载规格
 * @returns runtime
 */
function toMountRuntime(mount: GalleryMountSpec): GalleryMountRuntime {
  return {
    key: mount.key,
    messageId: mount.messageId,
    element: markRaw(mount.element),
    mountKey: mount.mountKey,
    generatedItem: null,
    kindPatch: null,
    anchor: {
      ...mount.anchor,
      target: markRaw(mount.anchor.target),
      paragraph: mount.anchor.paragraph ? markRaw(mount.anchor.paragraph) : null,
    },
  };
}

/**
 * 当前 DOM 可见 mes id 列表
 * @returns ids
 */
function listVisibleMessageIds(): number[] {
  return Array.from(document.querySelectorAll('#chat > .mes'))
    .map(div => Number(div.getAttribute('mesid')))
    .filter(id => Number.isFinite(id));
}

/**
 * 规范化事件 message id
 * @param messageId 原始值
 * @returns number 或 null
 */
function normalizeMessageId(messageId: unknown): number | null {
  if (typeof messageId === 'number' && Number.isFinite(messageId)) return messageId;
  if (typeof messageId === 'string' && messageId.trim()) {
    const value = Number(messageId);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

/**
 * 生成 reload_memo
 * @returns uuid
 */
function createReloadMemo(): string {
  return uuidv4();
}

/**
 * 扫描当前聊天全部楼层的位点短码引用
 *
 * - activeReferences：活动 swipe 正文里的短码，是正向清除的目标
 * - referencedSlotIds：含非活动 swipe 在内的全部引用，用于反向孤儿保护
 * @returns 活动引用与全量引用集合
 */
function scanChatSlotReferences(): { activeReferences: OrphanShortcodeRef[]; referencedSlotIds: Set<string> } {
  const activeReferences: OrphanShortcodeRef[] = [];
  const referencedSlotIds = new Set<string>();
  const messages = Array.isArray(chat) ? (chat as unknown[]) : [];
  messages.forEach((entry, messageId) => {
    for (const slotId of parseSlotIds(readMessageActiveText(entry))) {
      activeReferences.push({ slotId, messageId });
      referencedSlotIds.add(slotId);
    }
    for (const swipe of readMessageSwipeTexts(entry)) {
      for (const slotId of parseSlotIds(swipe)) referencedSlotIds.add(slotId);
    }
  });
  return { activeReferences, referencedSlotIds };
}

/**
 * 读取聊天条目的活动正文
 * @param entry chat 数组条目
 * @returns 活动 swipe 正文
 */
function readMessageActiveText(entry: unknown): string {
  const mes = (entry as { mes?: unknown } | null)?.mes;
  return typeof mes === 'string' ? mes : '';
}

/**
 * 读取聊天条目的全部 swipe 正文
 * @param entry chat 数组条目
 * @returns swipe 正文列表
 */
function readMessageSwipeTexts(entry: unknown): string[] {
  const swipes = (entry as { swipes?: unknown } | null)?.swipes;
  return Array.isArray(swipes) ? swipes.filter((swipe): swipe is string => typeof swipe === 'string') : [];
}

/**
 * 分楼定点剥离失效短码（同楼多枚合并为一次写回，refresh:'none' 避免丢临时画廊）
 * @param refs 待清除的失效短码引用
 */
async function applyOrphanShortcodeRemovals(refs: OrphanShortcodeRef[]): Promise<void> {
  const slotIdsByMessage = new Map<number, string[]>();
  for (const ref of refs) {
    slotIdsByMessage.set(ref.messageId, [...(slotIdsByMessage.get(ref.messageId) ?? []), ref.slotId]);
  }
  for (const [messageId, slotIds] of slotIdsByMessage) {
    const raw = readChatMessageRaw(messageId);
    if (raw === null) continue;
    let next = raw;
    for (const slotId of slotIds) next = removeSlotShortcode(next, slotId);
    if (next !== raw) await writeChatMessageRaw(messageId, next, 'none');
  }
}

/**
 * 读取指定作用域存有收藏的 slotId 集合（仅元数据，不下载图片）
 * @param scope 当前收藏作用域
 * @returns 收藏 slotId 集合
 */
async function listScopedFavoriteSlotIds(scope: InlineImageFavoriteScope): Promise<Set<string>> {
  const metas = await listInlineImageFavoriteMeta();
  const slotIds = new Set<string>();
  for (const meta of metas) {
    if (meta.characterKey === scope.characterKey && meta.chatId === scope.chatId) slotIds.add(meta.slotId);
  }
  return slotIds;
}

/**
 * 移除全部 cv-render 容器
 */
function removeAllRenderContainers(): void {
  document.querySelectorAll('#chat .cv-render').forEach(removeRenderContainer);
}
