import type { ImageSource } from '@/constants/comfyui';
import type { CharacterPromptItem } from '@/constants/novelai';
import type { ImagePromptVibeRef } from '@/constants/novelai-vibe';
import { buildInlineActionHostClass } from '@/composables/inlineImageDom';
import type { ComfyUIRequestSnapshot } from '@/services/comfyui/types';
import type { NovelAIFinalPrompts } from '@/services/novelai/api';
import type { NovelAIVibeParameters } from '@/services/novelai/vibe-types';
import { useSettingsStore } from '@/store/settings';

/** 内联生图提示词快照 */
export interface InlinePromptSnapshot {
  positivePrompt: string;
  negativePrompt: string;
  imageSource?: ImageSource;
  novelai?: NovelAIFinalPrompts;
  comfyui?: ComfyUIRequestSnapshot;
}

export interface InlineLightboxActions {
  onDownload?: () => void | Promise<void>;
}

/** 灯箱画廊单张条目（数据管理面板左右切换用） */
export interface InlineLightboxGalleryEntry {
  /** 图片地址；传函数时切换到该条目才解析（按需加载 Blob） */
  src: string | (() => string | Promise<string>);
  snapshot?: InlinePromptSnapshot;
  actions?: InlineLightboxActions;
}

/** 灯箱画廊配置 */
export interface InlineLightboxGallery {
  entries: InlineLightboxGalleryEntry[];
  /** 初始条目序号 */
  index?: number;
}

/** 打开灯箱的完整选项（向后兼容：仅传 onDownload 的旧用法仍有效） */
export interface InlineLightboxOptions extends InlineLightboxActions {
  gallery?: InlineLightboxGallery;
  /** 灯箱关闭回调（画廊持有方在此回收按需创建的 object URL） */
  onClose?: () => void;
}

/** 灯箱运行时状态 */
interface LightboxState {
  overlay: HTMLElement;
  /** 画廊条目（非画廊时仅 1 条） */
  entries: InlineLightboxGalleryEntry[];
  index: number;
  /** 是否展示左右切换 UI */
  isGallery: boolean;
  /** 导航令牌：快速切换时丢弃过期加载 */
  navToken: number;
  close: () => void;
}

/**
 * 克隆为 IndexedDB 可结构化保存的纯提示词快照
 * @param snapshot 原始提示词快照
 * @returns 去除响应式代理引用后的快照
 */
export function cloneInlinePromptSnapshot(snapshot: InlinePromptSnapshot): InlinePromptSnapshot {
  return {
    positivePrompt: snapshot.positivePrompt,
    negativePrompt: snapshot.negativePrompt,
    imageSource: snapshot.imageSource,
    novelai: snapshot.novelai ? cloneNovelAIFinalPrompts(snapshot.novelai) : undefined,
    comfyui: snapshot.comfyui ? cloneComfyUIRequestSnapshot(snapshot.comfyui) : undefined,
  };
}

/**
 * 克隆 NovelAI 最终提示词
 * @param prompts 原始 NovelAI 提示词
 * @returns 纯对象提示词
 */
function cloneNovelAIFinalPrompts(prompts: NovelAIFinalPrompts): NovelAIFinalPrompts {
  return {
    positivePrompt: prompts.positivePrompt,
    negativePrompt: prompts.negativePrompt,
    useCharacterCoords: prompts.useCharacterCoords,
    characterPrompts: prompts.characterPrompts?.map(cloneCharacterPromptItem),
    vibeReferences: prompts.vibeParameters ? undefined : prompts.vibeReferences?.map(cloneImagePromptVibeRef),
    vibeParameters: prompts.vibeParameters ? cloneNovelAIVibeParameters(prompts.vibeParameters) : undefined,
  };
}

/**
 * 克隆单个 NovelAI 角色提示词
 * @param item 原始角色提示词
 * @returns 纯对象角色提示词
 */
function cloneCharacterPromptItem(item: CharacterPromptItem): CharacterPromptItem {
  return {
    positivePrompt: item.positivePrompt,
    negativePrompt: item.negativePrompt,
    position: { x: item.position.x, y: item.position.y },
  };
}

/**
 * 克隆 NovelAI vibe 引用
 * @param vibe 原始 vibe 引用
 * @returns 纯对象 vibe 引用
 */
function cloneImagePromptVibeRef(vibe: ImagePromptVibeRef): ImagePromptVibeRef {
  return {
    id: vibe.id,
    sourceHash: vibe.sourceHash,
    enabled: vibe.enabled,
    referenceStrength: vibe.referenceStrength,
    informationExtracted: vibe.informationExtracted,
    temporary: vibe.temporary,
  };
}

/**
 * 克隆 NovelAI 官方 vibe 参数数组
 * @param parameters 原始 vibe 参数
 * @returns 纯数组 vibe 参数
 */
function cloneNovelAIVibeParameters(parameters: NovelAIVibeParameters): NovelAIVibeParameters {
  return {
    reference_image_multiple: [...parameters.reference_image_multiple],
    reference_strength_multiple: [...parameters.reference_strength_multiple],
    reference_information_extracted_multiple: [...parameters.reference_information_extracted_multiple],
  };
}

/**
 * 克隆 ComfyUI 请求快照
 * @param snapshot 原始 ComfyUI 快照
 * @returns 纯对象 ComfyUI 快照
 */
function cloneComfyUIRequestSnapshot(snapshot: ComfyUIRequestSnapshot): ComfyUIRequestSnapshot {
  return {
    endpoint: snapshot.endpoint,
    positivePrompt: snapshot.positivePrompt,
    negativePrompt: snapshot.negativePrompt,
    imageOutputNodeId: snapshot.imageOutputNodeId,
    promptBindings: snapshot.promptBindings.map(item => ({ ...item })),
    seedValues: snapshot.seedValues.map(item => ({ ...item })),
    loras: snapshot.loras.map(lora => ({ name: lora.name, strength: lora.strength })),
  };
}

/**
 * 处理内联生成的图片点击事件
 * @param e 点击事件对象
 * @param img 图片元素
 * @param wrap 外层容器元素
 * @param isRuntimeEnabled 是否启用运行时
 * @param snapshot 提示词快照
 */
export function handleInlineImageClick(
  e: MouseEvent,
  img: HTMLImageElement,
  wrap: HTMLElement,
  isRuntimeEnabled: () => boolean,
  snapshot?: InlinePromptSnapshot,
  actions?: InlineLightboxActions,
): void {
  if (!isRuntimeEnabled()) return;
  e.stopPropagation();
  const isTouch = window.matchMedia('(hover: none)').matches;
  if (isTouch && !wrap.classList.contains('cv-inline-img-active')) {
    wrap.classList.add('cv-inline-img-active');
    ensureInlineImageOutsideDismiss();
    return;
  }
  openInlineImageLightbox(img.src, snapshot, actions);
  if (isTouch) wrap.classList.remove('cv-inline-img-active');
}

/** 是否已绑定移动端外部点击收起监听 */
let inlineImageOutsideDismissBound = false;

/**
 * 懒绑定全局监听: 移动端点击图片外部时收起段落图片操作 UI
 */
function ensureInlineImageOutsideDismiss(): void {
  if (inlineImageOutsideDismissBound) return;
  inlineImageOutsideDismissBound = true;
  // 捕获阶段监听,不受内联控件 stopPropagation 影响
  document.addEventListener('pointerdown', dismissActiveInlineImages, true);
}

/**
 * 收起所有点击落在图片容器之外的激活态操作 UI
 * @param event 指针按下事件
 */
function dismissActiveInlineImages(event: PointerEvent): void {
  const target = event.target as Node | null;
  document.querySelectorAll<HTMLElement>('.cv-inline-img-wrap.cv-inline-img-active').forEach(wrap => {
    if (!target || !wrap.contains(target)) wrap.classList.remove('cv-inline-img-active');
  });
  // 无激活项时解绑,避免常驻监听
  if (!document.querySelector('.cv-inline-img-wrap.cv-inline-img-active')) {
    document.removeEventListener('pointerdown', dismissActiveInlineImages, true);
    inlineImageOutsideDismissBound = false;
  }
}

/**
 * 复制文本并更新按钮状态
 * @param text 复制的文本
 * @param btn 触发复制的按钮
 */
async function copyText(text: string, btn: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    markCopyButtonSuccess(btn);
  } catch {
    toastr.error('复制失败');
  }
}

/**
 * 标记复制按钮成功状态
 * @param btn 触发复制的按钮
 */
function markCopyButtonSuccess(btn: HTMLElement): void {
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-check"></i> 已复制';
  btn.classList.add('copied');
  window.setTimeout(() => {
    btn.innerHTML = originalHTML;
    btn.classList.remove('copied');
  }, 1500);
}

/**
 * 创建 Lightbox 的 DOM 结构（挂 body，需自带 cosmos-vision-root + dark class）
 * @param src 初始图片地址（画廊首张已解析的地址）
 * @param isGallery 是否为多图画廊（渲染左右切换与计数）
 * @param hasDownload 是否有任一条目可下载
 * @returns Lightbox 根元素
 */
function createLightboxDOM(src: string, isGallery: boolean, hasDownload: boolean): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = buildInlineActionHostClass('cv-lightbox-overlay', useSettingsStore().darkMode);
  overlay.innerHTML = buildLightboxMarkup(src, isGallery, hasDownload);
  return overlay;
}

/**
 * 构建 Lightbox HTML
 * 提示词详情面板留空，由 renderLightboxInfo 按当前条目填充（画廊切换时整体重建）
 * @param src 初始图片地址
 * @param isGallery 是否为多图画廊
 * @param hasDownload 是否有任一条目可下载
 * @returns HTML 字符串
 */
function buildLightboxMarkup(src: string, isGallery: boolean, hasDownload: boolean): string {
  return `
    ${buildLightboxToolbarMarkup(hasDownload, isGallery)}
    <div class="cv-lightbox-wrapper">
      ${buildLightboxNavMarkup(isGallery)}
      <div class="cv-lightbox-img-box">
        <img class="cv-lightbox-preview-img" src="${escapeHtml(src)}" alt="放大图片" draggable="false" />
      </div>
      <div class="cv-lightbox-info cv-info-collapsed"></div>
    </div>
  `;
}

/**
 * 构建 Lightbox 顶部操作栏
 * @param hasDownload 是否渲染下载按钮
 * @param isGallery 是否渲染序号计数
 * @returns HTML 字符串
 */
function buildLightboxToolbarMarkup(hasDownload: boolean, isGallery: boolean): string {
  return `
    <div class="cv-lightbox-toolbar">
      ${isGallery ? '<span class="cv-lightbox-counter"></span>' : ''}
      ${hasDownload
        ? '<button class="cv-lightbox-download" title="下载图片" aria-label="下载图片"><i class="fa-solid fa-download"></i></button>'
        : ''}
      <button class="cv-lightbox-close" title="关闭" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `;
}

/**
 * 构建画廊左右切换按钮 HTML（仅多图时渲染）
 * @param isGallery 是否为多图画廊
 * @returns HTML 字符串
 */
function buildLightboxNavMarkup(isGallery: boolean): string {
  if (!isGallery) return '';
  return `
    <button type="button" class="cv-lightbox-nav cv-lightbox-nav-prev" title="上一张" aria-label="上一张"><i class="fa-solid fa-chevron-left"></i></button>
    <button type="button" class="cv-lightbox-nav cv-lightbox-nav-next" title="下一张" aria-label="下一张"><i class="fa-solid fa-chevron-right"></i></button>
  `;
}

/**
 * 构建 Lightbox 头部 HTML
 * @returns HTML 字符串
 */
function buildLightboxHeaderMarkup(): string {
  return `
    <div class="cv-lightbox-info-header">
      <span class="cv-lightbox-info-title">提示词详情</span>
      <button class="cv-lightbox-toggle-btn" title="隐藏/显示提示词">
        <i class="fa-solid fa-eye"></i> <span>显示提示词</span>
      </button>
    </div>
  `;
}

/**
 * 构建提示词分组 HTML
 * @param kind 提示词类型
 * @param title 分组标题
 * @param text 提示词内容
 * @returns HTML 字符串
 */
function buildPromptGroupMarkup(kind: 'pos' | 'neg', title: string, text: string): string {
  return `
    <div class="cv-lightbox-prompt-group">
      <div class="cv-lightbox-prompt-header">
        <span class="cv-lightbox-prompt-title cv-lightbox-title-${kind}">${title}</span>
        <button class="cv-lightbox-copy-btn cv-copy-${kind}"><i class="fa-solid fa-copy"></i> 复制</button>
      </div>
      <div class="cv-lightbox-prompt-content">${escapeHtml(text)}</div>
    </div>
  `;
}

/**
 * 构建角色提示词区域 HTML（有角色时才渲染）
 * @param snapshot 提示词快照
 * @returns HTML 字符串
 */
function buildCharacterPromptsMarkup(snapshot?: InlinePromptSnapshot): string {
  const characters = snapshot?.novelai?.characterPrompts ?? [];
  if (!characters.length) return '';
  return `
    <div class="cv-lightbox-prompt-group cv-lightbox-character-section">
      <div class="cv-lightbox-prompt-header">
        <span class="cv-lightbox-prompt-title cv-lightbox-title-char">角色提示词（${characters.length}）</span>
      </div>
      <div class="cv-lightbox-character-list">
        ${characters.map((item, index) => buildCharacterItemMarkup(item, index, characters.length, snapshot?.novelai?.useCharacterCoords)).join('')}
      </div>
    </div>
  `;
}

/**
 * 构建单个角色提示词折叠项 HTML（默认折叠）
 * @param item 角色提示词
 * @param index 角色序号（从 0 起）
 * @param characterCount 角色总数
 * @param useCharacterCoords 是否使用手动坐标
 * @returns HTML 字符串
 */
function buildCharacterItemMarkup(
  item: CharacterPromptItem,
  index: number,
  characterCount: number,
  useCharacterCoords?: boolean,
): string {
  return `
    <div class="cv-lightbox-character-item cv-char-collapsed" data-char-index="${index}">
      <button type="button" class="cv-lightbox-character-toggle" aria-expanded="false">
        <i class="fa-solid fa-chevron-right cv-lightbox-character-chevron"></i>
        <span class="cv-lightbox-character-title">${escapeHtml(getCharacterItemTitle(item, index))}</span>
      </button>
      <div class="cv-lightbox-character-body">
        <div class="cv-lightbox-character-field">
          <div class="cv-lightbox-character-label-row">
            <span class="cv-lightbox-character-label">角色正面</span>
            <button class="cv-lightbox-copy-btn cv-copy-char-pos" data-char-index="${index}"><i class="fa-solid fa-copy"></i> 复制</button>
          </div>
          <div class="cv-lightbox-prompt-content">${escapeHtml(item.positivePrompt || '(空)')}</div>
        </div>
        <div class="cv-lightbox-character-field">
          <div class="cv-lightbox-character-label-row">
            <span class="cv-lightbox-character-label">角色负面</span>
            <button class="cv-lightbox-copy-btn cv-copy-char-neg" data-char-index="${index}"><i class="fa-solid fa-copy"></i> 复制</button>
          </div>
          <div class="cv-lightbox-prompt-content">${escapeHtml(item.negativePrompt || '(空)')}</div>
        </div>
        <div class="cv-lightbox-character-field">
          <span class="cv-lightbox-character-label">坐标</span>
          <div class="cv-lightbox-prompt-content">${escapeHtml(formatCharacterPosition(item, characterCount, useCharacterCoords))}</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 生成角色折叠标题（序号 + 正面提示词预览）
 * @param item 角色提示词
 * @param index 角色序号
 * @returns 标题文本
 */
function getCharacterItemTitle(item: CharacterPromptItem, index: number): string {
  const preview = item.positivePrompt.trim() || '(空)';
  const short = preview.length > 36 ? `${preview.slice(0, 36)}…` : preview;
  return `角色 ${index + 1} · ${short}`;
}

/**
 * 格式化角色坐标展示文本
 * @param item 角色提示词
 * @param characterCount 角色总数
 * @param useCharacterCoords 是否使用手动坐标
 * @returns 坐标文本
 */
function formatCharacterPosition(item: CharacterPromptItem, characterCount: number, useCharacterCoords?: boolean): string {
  if (characterCount < 2 || useCharacterCoords === false) return 'Auto';
  return `x: ${item.position.x.toFixed(2)}, y: ${item.position.y.toFixed(2)}`;
}

/**
 * 转义 Lightbox 内插文本
 * @param value 原始文本
 * @returns 安全 HTML 文本
 */
function escapeHtml(value: string): string {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

/**
 * 绑定 Lightbox 相关的事件并渲染初始详情面板
 * @param state 灯箱状态
 */
function bindLightboxEvents(state: LightboxState): void {
  const overlay = state.overlay;
  overlay.addEventListener('click', e => handleOverlayClick(e, overlay, state.close));
  overlay.querySelector('.cv-lightbox-close')?.addEventListener('click', state.close);
  bindLightboxDownload(state);
  if (state.isGallery) {
    overlay.querySelector('.cv-lightbox-nav-prev')?.addEventListener('click', () => navigateLightbox(state, -1));
    overlay.querySelector('.cv-lightbox-nav-next')?.addEventListener('click', () => navigateLightbox(state, 1));
    bindLightboxSwipe(state);
  }
  renderLightboxInfo(state);
  updateLightboxNavUi(state);
}

/**
 * 绑定 Lightbox 下载按钮
 * 点击时读取当前条目的下载动作，切换条目后自动指向新条目
 * @param state 灯箱状态
 */
function bindLightboxDownload(state: LightboxState): void {
  const button = state.overlay.querySelector('.cv-lightbox-download');
  if (!button) return;
  button.addEventListener('click', () => {
    void Promise.resolve(state.entries[state.index]?.actions?.onDownload?.()).catch(error => {
      console.error('[CosmosVision] 下载图片失败', error);
    });
  });
  syncDownloadButton(state);
}

/**
 * 同步下载按钮可见性与当前条目动作
 * @param state 灯箱状态
 */
function syncDownloadButton(state: LightboxState): void {
  const button = state.overlay.querySelector<HTMLElement>('.cv-lightbox-download');
  if (!button) return;
  button.style.display = state.entries[state.index]?.actions?.onDownload ? '' : 'none';
}

/**
 * 处理 Lightbox 背景点击
 * @param e 点击事件
 * @param overlay Lightbox 根元素
 * @param close 关闭方法
 */
function handleOverlayClick(e: MouseEvent, overlay: HTMLElement, close: () => void): void {
  if (e.target === overlay || e.target === overlay.querySelector('.cv-lightbox-img-box')) close();
}

/**
 * 绑定提示词详情折叠按钮
 * @param overlay Lightbox 根元素
 */
function bindLightboxToggle(overlay: HTMLElement): void {
  const info = overlay.querySelector('.cv-lightbox-info') as HTMLElement | null;
  const toggleBtn = overlay.querySelector('.cv-lightbox-toggle-btn') as HTMLElement | null;
  toggleBtn?.addEventListener('click', () => togglePromptInfo(info, toggleBtn));
}

/**
 * 切换提示词详情显示状态
 * @param info 提示词面板
 * @param toggleBtn 切换按钮
 */
function togglePromptInfo(info: HTMLElement | null, toggleBtn: HTMLElement): void {
  const isCollapsed = Boolean(info?.classList.toggle('cv-info-collapsed'));
  const icon = isCollapsed ? 'fa-eye' : 'fa-eye-slash';
  const text = isCollapsed ? '显示' : '隐藏';
  toggleBtn.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${text}</span>`;
}

/**
 * 绑定提示词复制按钮
 * @param overlay Lightbox 根元素
 * @param snapshot 提示词快照
 */
function bindLightboxCopyButtons(overlay: HTMLElement, snapshot?: InlinePromptSnapshot): void {
  const copyPos = overlay.querySelector('.cv-copy-pos');
  const copyNeg = overlay.querySelector('.cv-copy-neg');
  copyPos?.addEventListener('click', e => copyText(snapshot?.positivePrompt || '', e.currentTarget as HTMLElement));
  copyNeg?.addEventListener('click', e => copyText(snapshot?.negativePrompt || '', e.currentTarget as HTMLElement));

  const characters = snapshot?.novelai?.characterPrompts ?? [];
  overlay.querySelectorAll<HTMLElement>('.cv-copy-char-pos').forEach(btn => {
    btn.addEventListener('click', e => {
      const idxStr = btn.dataset.charIndex;
      const idx = idxStr !== undefined ? parseInt(idxStr, 10) : -1;
      const text = characters[idx]?.positivePrompt || '';
      void copyText(text, e.currentTarget as HTMLElement);
    });
  });

  overlay.querySelectorAll<HTMLElement>('.cv-copy-char-neg').forEach(btn => {
    btn.addEventListener('click', e => {
      const idxStr = btn.dataset.charIndex;
      const idx = idxStr !== undefined ? parseInt(idxStr, 10) : -1;
      const text = characters[idx]?.negativePrompt || '';
      void copyText(text, e.currentTarget as HTMLElement);
    });
  });
}

/**
 * 绑定角色提示词单项折叠按钮（默认折叠）
 * @param overlay Lightbox 根元素
 */
function bindCharacterItemToggles(overlay: HTMLElement): void {
  overlay.querySelectorAll('.cv-lightbox-character-item').forEach(node => {
    const item = node as HTMLElement;
    const toggle = item.querySelector('.cv-lightbox-character-toggle') as HTMLElement | null;
    toggle?.addEventListener('click', e => {
      e.stopPropagation();
      toggleCharacterItem(item, toggle);
    });
  });
}

/**
 * 切换单个角色提示词的折叠状态
 * @param item 角色项容器
 * @param toggle 折叠按钮
 */
function toggleCharacterItem(item: HTMLElement, toggle: HTMLElement): void {
  const collapsed = item.classList.toggle('cv-char-collapsed');
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const chevron = toggle.querySelector('.cv-lightbox-character-chevron');
  if (chevron) {
    chevron.classList.toggle('fa-chevron-right', collapsed);
    chevron.classList.toggle('fa-chevron-down', !collapsed);
  }
}

/**
 * 打开 Lightbox 大图预览弹窗
 * 传入 gallery 时可左右切换浏览多张图片（按钮 / 方向键 / 移动端滑动）
 * @param src 初始图片地址
 * @param snapshot 初始提示词快照
 * @param options 灯箱选项（下载动作 / 画廊 / 关闭回调）
 */
export function openInlineImageLightbox(
  src: string,
  snapshot?: InlinePromptSnapshot,
  options?: InlineLightboxOptions,
): void {
  const gallery = options?.gallery;
  const entries: InlineLightboxGalleryEntry[] = gallery?.entries?.length
    ? gallery.entries
    : [{ src, snapshot, actions: { onDownload: options?.onDownload } }];
  const requestedIndex = gallery?.entries?.length ? (gallery.index ?? 0) : 0;
  const index = Math.min(Math.max(requestedIndex, 0), entries.length - 1);
  const isGallery = entries.length > 1;
  const hasDownload = entries.some(entry => entry.actions?.onDownload);
  const overlay = createLightboxDOM(src, isGallery, hasDownload);

  let closed = false;
  let handleKey: (e: KeyboardEvent) => void = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.remove('cv-lightbox-active');
    window.setTimeout(() => overlay.remove(), 250);
    document.removeEventListener('keydown', handleKey);
    options?.onClose?.();
  };
  const state: LightboxState = { overlay, entries, index, isGallery, navToken: 0, close };

  handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (!isGallery) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateLightbox(state, -1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateLightbox(state, 1);
    }
  };
  document.addEventListener('keydown', handleKey);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('cv-lightbox-active');
  });
  bindLightboxEvents(state);
}

/**
 * 切换画廊条目（越界忽略）
 * @param state 灯箱状态
 * @param direction 方向：-1 上一张 / 1 下一张
 */
function navigateLightbox(state: LightboxState, direction: -1 | 1): void {
  const next = state.index + direction;
  if (next < 0 || next >= state.entries.length) return;
  void showLightboxEntry(state, next);
}

/**
 * 渲染指定画廊条目
 * 懒解析条目 src；快速连续切换时仅保留最后一次的结果
 * @param state 灯箱状态
 * @param index 目标条目序号
 */
async function showLightboxEntry(state: LightboxState, index: number): Promise<void> {
  const entry = state.entries[index];
  if (!entry || index === state.index) return;
  state.index = index;
  const token = ++state.navToken;
  const img = state.overlay.querySelector<HTMLImageElement>('.cv-lightbox-preview-img');
  const imgBox = state.overlay.querySelector<HTMLElement>('.cv-lightbox-img-box');
  imgBox?.classList.add('cv-lightbox-img-loading');
  updateLightboxNavUi(state);
  try {
    const nextSrc = typeof entry.src === 'function' ? await entry.src() : entry.src;
    if (token !== state.navToken) return;
    if (img) img.src = nextSrc;
    renderLightboxInfo(state);
    syncDownloadButton(state);
  } catch (error) {
    if (token === state.navToken) toastr.error('图片加载失败');
    console.warn('[CosmosVision] 灯箱图片加载失败', error);
  } finally {
    if (token === state.navToken) imgBox?.classList.remove('cv-lightbox-img-loading');
  }
}

/**
 * 更新画廊序号计数与切换按钮可用态
 * @param state 灯箱状态
 */
function updateLightboxNavUi(state: LightboxState): void {
  const counter = state.overlay.querySelector<HTMLElement>('.cv-lightbox-counter');
  if (counter) counter.textContent = `${state.index + 1} / ${state.entries.length}`;
  const prev = state.overlay.querySelector<HTMLButtonElement>('.cv-lightbox-nav-prev');
  const next = state.overlay.querySelector<HTMLButtonElement>('.cv-lightbox-nav-next');
  if (prev) prev.disabled = state.index <= 0;
  if (next) next.disabled = state.index >= state.entries.length - 1;
}

/**
 * 渲染提示词详情面板（画廊切换时整体重建并回到折叠态）
 * @param state 灯箱状态
 */
function renderLightboxInfo(state: LightboxState): void {
  const info = state.overlay.querySelector<HTMLElement>('.cv-lightbox-info');
  if (!info) return;
  const snapshot = state.entries[state.index]?.snapshot;
  info.classList.add('cv-info-collapsed');
  info.innerHTML = `
    ${buildLightboxHeaderMarkup()}
    <div class="cv-lightbox-info-body">
      ${buildPromptGroupMarkup('pos', '正向提示词', snapshot?.positivePrompt || '无正向提示词')}
      ${buildPromptGroupMarkup('neg', '负面提示词', snapshot?.negativePrompt || '无负面提示词')}
      ${buildCharacterPromptsMarkup(snapshot)}
    </div>
  `;
  bindLightboxToggle(state.overlay);
  bindLightboxCopyButtons(state.overlay, snapshot);
  bindCharacterItemToggles(state.overlay);
}

/**
 * 绑定移动端图片左右滑动切换
 * @param state 灯箱状态
 */
function bindLightboxSwipe(state: LightboxState): void {
  const imgBox = state.overlay.querySelector<HTMLElement>('.cv-lightbox-img-box');
  if (!imgBox) return;
  let startX = 0;
  let startY = 0;
  imgBox.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
  }, { passive: true });
  imgBox.addEventListener('touchend', e => {
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    // 水平位移显著大于纵向才视为切换手势，避免与纵向滚动冲突
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
    navigateLightbox(state, deltaX < 0 ? 1 : -1);
  }, { passive: true });
}
