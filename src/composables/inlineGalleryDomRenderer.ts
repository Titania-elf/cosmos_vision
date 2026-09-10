import { DARK_CLASS } from '@/constants/default-settings';
import {
  loadMountGalleryItems,
  removeMountItem,
  revokeTrackedObjectUrls,
  toggleMountFavorite,
  invokeDownload,
  invokeGenerateEditable,
  invokeGenerateFresh,
  invokeGenerateLast,
} from '@/composables/inlineGalleryMountActions';
import { handleInlineImageClick } from '@/composables/inlineImageLightbox';
import { openGenerationSchemeDialog } from '@/composables/generationSchemeDialogLauncher';
import { preventInlineEventBubbling } from '@/composables/inlineImageDom';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';
import type { GalleryMountRuntime } from '@/store/gallery-runtimes';
import type { InlineGalleryItem } from '@/composables/inlineImageGalleryView';

/**
 * 命令式画廊渲染器：纯原生 DOM，零 Vue 依赖
 *
 * 历史方案（Teleport defer / 独立 render() / slot-data-bus / cv-gallery
 * 自定义元素）全部无法根治"二次生图不更新、点击无响应、Vue patch 读
 * null subTree 崩溃"——根因是 Vue 组件树嵌入 ST 聊天 DOM 后所有权分叉。
 *
 * 本渲染器与灯箱（inlineImageLightbox）同模式：DOM 由 createElement
 * 程序化构建、事件 addEventListener 直绑、数据变了全量重画。没有
 * vnode、没有组件实例、没有响应式 effect 跨越"ST 重写 DOM"存活，
 * ST 删容器时 DOM 随之消亡，零残留。
 *
 * 焦点状态存在 DOM data 属性上（data-cv-active-id）——DOM 被删焦点
 * 自然消失，重建默认第一张，自洽。
 */

/** 单个挂载的运行时上下文（每容器一份，闭包持有） */
interface GalleryDomContext {
  container: HTMLElement;
  mount: GalleryMountRuntime;
  items: InlineGalleryItem[];
  objectUrls: Set<string>;
  root: HTMLElement | null;
}

/** 已渲染容器注册表：container 元素 → 渲染上下文 */
const renderedGalleries = new Map<HTMLElement, GalleryDomContext>();

/** 数据版本：slotId → 版本号（画廊数据变化的唯一信号源） */
const slotVersions = new Map<string, number>();

/** store 引用注入（协调者启动时提供，避免渲染器↔store 循环依赖） */
let galleryStoreApi: { removeMount: (key: string, messageId: number) => void } | null = null;

/**
 * 注入 gallery store API（协调者 setup 时调用一次）
 * @param api store 操作子集
 */
export function provideGalleryStoreApi(api: { removeMount: (key: string, messageId: number) => void }): void {
  galleryStoreApi = api;
}

/**
 * 通知某 slot 数据变化（新图/收藏/删除/淘汰后调用）
 * 命令式渲染靠此信号重读数据重画；新图（items 增多）强制焦点最新一张
 * @param slotId 位点 id
 */
export function notifyGallerySlotChanged(slotId: string): void {
  if (!slotId) return;
  slotVersions.set(slotId, (slotVersions.get(slotId) ?? 0) + 1);
  pendingFocusLatest.add(slotId);
  rerenderSlotGalleries(slotId);
}

/** 待"焦点切最新"的 slot 集合（数据重画前消费） */
const pendingFocusLatest = new Set<string>();

/** 每容器的串行渲染队列：后到的重画排队，避免并发 await 交错覆盖焦点 */
const renderQueues = new Map<HTMLElement, Promise<void>>();

/**
 * 渲染或刷新一个容器的画廊（幂等、容器内串行）
 * 数据全量重读：从 IDB / 会话 / 收藏清单现取，DOM 全量重建
 * @param mount 挂载运行时对象
 */
export function renderGalleryDom(mount: GalleryMountRuntime): Promise<void> {
  const container = mount.element;
  if (!container.isConnected) return Promise.resolve();
  const previous = renderQueues.get(container) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => paintGalleryForMount(mount));
  renderQueues.set(container, run);
  return run;
}

/** 实际执行读取与重画（串行队列内调用） */
async function paintGalleryForMount(mount: GalleryMountRuntime): Promise<void> {
  const container = mount.element;
  if (!container.isConnected) return;

  const context = renderedGalleries.get(container);
  const objectUrls = context?.objectUrls ?? new Set<string>();
  const activeId = context?.root?.dataset.cvActiveId ?? '';
  // 新图信号：数据变化通知触发本次重画时，焦点强制切到最新一张
  const focusLatest = pendingFocusLatest.delete(mount.mountKey.slotId);

  // 全量重读（新图与恢复同一条路）；objectUrls 集合跨重画复用，
  // 未被淘汰的图沿用同一 URL（不闪屏），淘汰图在卸载时统一回收
  const items = await loadMountGalleryItems(mount, objectUrls);

  const nextContext: GalleryDomContext = { container, mount, items, objectUrls, root: null };
  renderedGalleries.set(container, nextContext);
  const preferred = focusLatest || !context ? (items[0]?.id ?? '') : activeId;
  paintGallery(container, nextContext, preferred);
}

/**
 * 画一个容器（清空重画；焦点尽量保留）
 */
function paintGallery(container: HTMLElement, context: GalleryDomContext, preferredActiveId: string): void {
  // 旧节点整体移除（无 Vue unmount，纯 DOM 摘除）
  context.root?.remove();
  context.root = null;

  const { items } = context;
  if (!items.length) {
    paintLostPlaceholder(container, context);
    return;
  }

  const activeId = items.some(item => item.id === preferredActiveId) ? preferredActiveId : (items[0]!.id);
  const root = buildGalleryRoot(context, activeId);
  container.replaceChildren(root);
  context.root = root;
}

/**
 * 画"源文件丢失"占位符
 */
function paintLostPlaceholder(container: HTMLElement, context: GalleryDomContext): void {
  const root = document.createElement('div');
  root.className = 'cv-inline-img-wrap cv-inline-favorite-wrap cosmos-vision-root';
  root.innerHTML = `
    <div class="cv-inline-favorite-content">
      <div class="cv-inline-favorite-galleria">
        <div class="cv-inline-favorite-stage">
          <div class="cv-lost-placeholder">
            <div class="cv-lost-warning">
              <span class="cv-lost-icon">⚠️</span>
              <span class="cv-lost-text">此段落绑定的图片源文件已被清理或丢失。</span>
            </div>
            <div class="cv-lost-actions">
              <button type="button" class="cv-delete-shortcode-btn" title="彻底从聊天原文中删除此短码并移除占位符">彻底删除图片定位码</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  root.querySelector<HTMLButtonElement>('.cv-delete-shortcode-btn')?.addEventListener('click', () => {
    void forceDeleteShortcode(context.mount);
  });
  container.replaceChildren(root);
  context.root = root;
}

/**
 * 强删短码（原 InlineGalleryMount onForceDeleteShortcode 的命令式移植）
 */
async function forceDeleteShortcode(mount: GalleryMountRuntime): Promise<void> {
  const settingsStore = useSettingsStore();
  if (!settingsStore.savedSettings.enabled) return;
  const { removeSlotShortcodeFromMessage } = await import('@/services/inline-image/slot-bind');
  const { deleteFloorTailSlot } = await import('@/services/inline-image/floor-tail-slot');
  try {
    const target = mount.anchor.paragraph ?? mount.messageId;
    if (target) await removeSlotShortcodeFromMessage(target, mount.mountKey.slotId);
    if (!mount.anchor.paragraph) deleteFloorTailSlot(mount.mountKey.slotId);
    galleryStoreApi?.removeMount(mount.key, mount.messageId);
    toastr.success('已成功移除失效短码并清理占位符');
  } catch (error) {
    console.error('[CosmosVision] 强制删除短码失败', error);
    toastr.error('删除失效短码失败');
  }
}

/**
 * 构建画廊根节点（主图 + 操作条 + 缩略图条）
 */
function buildGalleryRoot(context: GalleryDomContext, activeId: string): HTMLElement {
  const settingsStore = useSettingsStore();
  const { darkMode } = storeToRefs(settingsStore);
  const { items, mount } = context;

  const root = document.createElement('div');
  root.className = darkMode.value
    ? 'cv-inline-img-wrap cv-inline-favorite-wrap cosmos-vision-root' + ` ${DARK_CLASS}`
    : 'cv-inline-img-wrap cv-inline-favorite-wrap cosmos-vision-root';
  root.dataset.cvActiveId = activeId;
  preventInlineEventBubbling(root);

  const content = document.createElement('div');
  content.className = 'cv-inline-favorite-content';

  const main = document.createElement('div');
  main.className = 'cv-inline-favorite-main';
  main.appendChild(document.createElement('div')).className = 'cv-inline-generation-overlay-shell';

  const activeItem = items.find(item => item.id === activeId) ?? items[0]!;
  main.appendChild(buildFocusStage(context, activeItem, darkMode.value));
  content.appendChild(main);

  if (items.length > 1) {
    content.appendChild(buildThumbnailStrip(context, activeId));
  }
  root.appendChild(content);
  void mount; // mount 用于操作回调
  return root;
}

/**
 * 构建主图舞台（图片 + 角标按钮 + 操作条）
 */
function buildFocusStage(context: GalleryDomContext, item: InlineGalleryItem, darkMode: boolean): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'cv-inline-favorite-stage';

  const img = document.createElement('img');
  img.className = 'cv-inline-favorite-img';
  img.src = item.objectUrl;
  img.alt = '生成的图片';
  img.draggable = false;
  img.addEventListener('click', event => {
    handleInlineImageClick(
      event,
      img,
      stage,
      () => useSettingsStore().savedSettings.enabled,
      item.promptSnapshot,
      { onDownload: () => invokeDownload(item) },
    );
  });
  stage.appendChild(img);

  stage.appendChild(buildFavoriteToggle(context, item));
  stage.appendChild(buildRemoveToggle(context));

  stage.appendChild(buildActionRow(context, item, darkMode));
  return stage;
}

/**
 * 构建收藏角标按钮
 */
function buildFavoriteToggle(context: GalleryDomContext, item: InlineGalleryItem): HTMLButtonElement {
  const active = typeof item.favoriteId === 'number';
  const label = active ? '取消收藏' : '收藏图片';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cv-inline-corner-button cv-inline-favorite-toggle' + (active ? ' cv-inline-favorite-toggle--active' : '');
  button.title = label;
  button.setAttribute('aria-label', label);
  const icon = document.createElement('i');
  icon.className = `cv-inline-favorite-star fa-star ${active ? 'fa-solid' : 'fa-regular'}`;
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  button.addEventListener('click', () => {
    void toggleMountFavorite(context.mount, item, context.items).then(() => {
      notifyGallerySlotChanged(context.mount.mountKey.slotId);
    }).catch(error => {
      console.error('[CosmosVision] 切换段落图片收藏失败', error);
      toastr.error(error instanceof Error ? error.message : '切换段落图片收藏失败');
    });
  });
  return button;
}

/**
 * 构建移除角标按钮（移除当前焦点图；删空则走删码路径）
 */
function buildRemoveToggle(context: GalleryDomContext): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cv-inline-corner-button cv-inline-remove-toggle';
  button.title = '移除';
  button.setAttribute('aria-label', '移除');
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-trash';
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  button.addEventListener('click', () => {
    const activeId = context.root?.dataset.cvActiveId ?? context.items[0]?.id;
    const item = context.items.find(candidate => candidate.id === activeId);
    if (!item) return;
    void removeMountItem(context.mount, item, context.items).then(keep => {
      if (keep) {
        notifyGallerySlotChanged(context.mount.mountKey.slotId);
      } else {
        // 全部移除：容器由 store 剔除，协调者对账时清理
        notifyGallerySlotChanged(context.mount.mountKey.slotId);
      }
    }).catch(error => {
      console.error('[CosmosVision] 删除段落图片失败', error);
      toastr.error('删除段落图片失败');
    });
  });
  return button;
}

/**
 * 构建操作条（重新生图等）
 */
function buildActionRow(context: GalleryDomContext, item: InlineGalleryItem, darkMode: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = darkMode
    ? `cv-inline-img-actions cosmos-vision-root ${DARK_CLASS}`
    : 'cv-inline-img-actions cosmos-vision-root';
  const inner = document.createElement('div');
  inner.className = 'cv-inline-button-row';

  const actions: Array<{ label: string; icon: string; onClick: () => void }> = [
    { label: '重新生图', icon: 'fa-solid fa-repeat', onClick: () => invokeGenerateLast(context.mount, item) },
    { label: '编辑TAG后重新生图', icon: 'fa-solid fa-pen-to-square', onClick: () => invokeGenerateEditable(context.mount, item) },
    { label: '重新生成TAG和图片', icon: 'fa-solid fa-robot', onClick: () => invokeGenerateFresh(context.mount) },
  ];
  if (item.promptSnapshot.imageSource === 'comfyui') {
    actions.push({
      label: '生图方案',
      icon: 'fa-solid fa-sliders',
      onClick: () => openGenerationSchemeDialog(item.promptSnapshot),
    });
  }
  for (const action of actions) {
    inner.appendChild(buildActionButton(action));
  }
  row.appendChild(inner);
  return row;
}

/**
 * 构建单个操作按钮（原生 button，样式沿用 cv-inline-action-button）
 */
function buildActionButton(action: { label: string; icon: string; onClick: () => void }): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cv-inline-action-button cv-inline-action-button--dom';
  const icon = document.createElement('i');
  icon.className = action.icon;
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'cv-inline-action-button-label';
  label.textContent = action.label;
  button.appendChild(icon);
  button.appendChild(label);
  button.addEventListener('click', action.onClick);
  return button;
}

/**
 * 构建缩略图条
 */
function buildThumbnailStrip(context: GalleryDomContext, activeId: string): HTMLElement {
  const { items } = context;
  const strip = document.createElement('div');
  strip.className = 'cv-inline-gallery-strip';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', '图片缩略图');

  strip.appendChild(buildStripNavButton(context, -1));

  const viewport = document.createElement('div');
  viewport.className = 'cv-inline-gallery-strip-viewport';
  const list = document.createElement('div');
  list.className = 'cv-inline-gallery-strip-list';
  items.forEach((item, index) => {
    list.appendChild(buildThumbnailItem(context, item, index, activeId));
  });
  viewport.appendChild(list);
  strip.appendChild(viewport);

  strip.appendChild(buildStripNavButton(context, 1));
  return strip;
}

/**
 * 构建单个缩略图按钮（点击切换焦点 → 重画主图）
 */
function buildThumbnailItem(context: GalleryDomContext, item: InlineGalleryItem, index: number, activeId: string): HTMLButtonElement {
  const active = item.id === activeId;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cv-prime-galleria-thumbnail-item cv-inline-gallery-strip-item';
  button.dataset.pActive = active ? 'true' : 'false';
  button.setAttribute('aria-label', `切换到第 ${index + 1} 张图片`);
  button.setAttribute('aria-pressed', String(active));
  const img = document.createElement('img');
  img.className = 'cv-inline-favorite-thumb';
  img.src = item.objectUrl;
  img.alt = '';
  img.draggable = false;
  button.appendChild(img);
  button.addEventListener('click', () => {
    if (!context.root) return;
    context.root.dataset.cvActiveId = item.id;
    paintGallery(context.container, context, item.id);
  });
  return button;
}

/**
 * 构建缩略图导航箭头
 */
function buildStripNavButton(context: GalleryDomContext, step: -1 | 1): HTMLButtonElement {
  const { items, root } = context;
  const currentId = root?.dataset.cvActiveId ?? items[0]?.id ?? '';
  const activeIndex = Math.max(0, items.findIndex(item => item.id === currentId));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cv-prime-galleria-nav-button cv-inline-gallery-strip-nav';
  button.disabled = items.length <= 1;
  const isPrev = step === -1;
  button.setAttribute('aria-label', isPrev ? '上一张' : '下一张');
  const icon = document.createElement('i');
  icon.className = `cv-prime-galleria-nav-icon ${isPrev ? 'fa-solid fa-chevron-left' : 'fa-solid fa-chevron-right'}`;
  icon.setAttribute('aria-hidden', 'true');
  button.appendChild(icon);
  button.addEventListener('click', () => {
    const total = context.items.length;
    if (total <= 1) return;
    const next = (activeIndex + step + total) % total;
    const nextItem = context.items[next];
    if (nextItem) {
      context.root!.dataset.cvActiveId = nextItem.id;
      paintGallery(context.container, context, nextItem.id);
    }
  });
  return button;
}

/**
 * 重渲染指定 slot 的全部存活画廊（数据变化信号入口）
 */
function rerenderSlotGalleries(slotId: string): void {
  for (const context of renderedGalleries.values()) {
    if (context.mount.mountKey.slotId === slotId) {
      void renderGalleryDom(context.mount);
    }
  }
}

/**
 * 移除一个容器的画廊 DOM 与注册（容器被 store 剔除/重建时调用）
 */
export function unmountGalleryDom(container: HTMLElement): void {
  const context = renderedGalleries.get(container);
  if (!context) return;
  renderedGalleries.delete(container);
  revokeTrackedObjectUrls(context.objectUrls);
  context.root?.remove();
  context.root = null;
}

/**
 * 全量清理（插件停用 / 聊天切换）
 */
export function clearAllGalleryDom(): void {
  for (const container of [...renderedGalleries.keys()]) {
    unmountGalleryDom(container);
  }
  slotVersions.clear();
}

/**
 * 列举已接管容器（协调者同步用）
 */
export function listGalleryDomContainers(): HTMLElement[] {
  return [...renderedGalleries.keys()];
}
