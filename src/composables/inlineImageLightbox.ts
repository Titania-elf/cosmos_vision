import type { ImageSource } from '@/constants/comfyui';
import type { CharacterPromptItem } from '@/constants/novelai';
import type { ImagePromptVibeRef } from '@/constants/novelai-vibe';
import type { ComfyUIRequestSnapshot } from '@/services/comfyui/types';
import type { NovelAIFinalPrompts } from '@/services/novelai/api';
import type { NovelAIRequestInfo } from '@/services/novelai/types';
import type { NovelAIVibeParameters } from '@/services/novelai/vibe-types';
import { reactive } from 'vue';
import type { ImageCompositionSnapshot } from '@/constants/image-composition';

/** 单侧提示词部件：可变（core）与不可变（模板）分离 */
export interface InlinePromptParts {
  /** LLM 输出或用户编辑后的核心文本（不含预设模板、不含质量词） */
  core: string;
  /** 实际使用的预设 ID；'' = 原样（无模板） */
  presetId: string;
}

/** 内联生图提示词快照 */
export interface InlinePromptSnapshot {
  positivePrompt?: string;
  negativePrompt?: string;
  imageSource?: ImageSource;
  novelai?: NovelAIFinalPrompts;
  comfyui?: ComfyUIRequestSnapshot;
  promptParts?: { positive: InlinePromptParts; negative: InlinePromptParts };
  /** 生成成功时记录的 NovelAI 参数与命中渠道，旧快照无此字段 */
  novelaiRequest?: NovelAIRequestInfo;
  /** 本图实际应用的自动构图及尺寸，供编辑和重生成沿用。 */
  composition?: ImageCompositionSnapshot;
}

export interface InlineLightboxActions {
  onDownload?: () => void | Promise<void>;
}

/**
 * 灯箱图片池：提供可左右翻页的图片序列
 *
 * 调用方持有图片列表与地址（例如缩略图 object URL 缓存），灯箱只按 key 查询；
 * srcOf 返回空串表示该图仍在加载，灯箱展示加载态而不是空白图。
 */
export interface InlineLightboxGallery {
  /** 图片 key 的稳定快照（顺序即翻页顺序） */
  keys(): readonly string[];
  /** 按 key 取图片地址，未就绪返回空串 */
  srcOf(key: string): string;
  /** 按 key 取提示词快照，无快照返回 undefined */
  snapshotOf(key: string): InlinePromptSnapshot | undefined;
  /** 按 key 取单张下载动作，无下载动作返回 undefined */
  downloadOf(key: string): (() => void | Promise<void>) | undefined;
  /** 请求加载指定 key 的图片（幂等，可对相邻图片预取） */
  ensure(key: string): void;
}

/** 灯箱批量操作上下文：勾选与执行都回落到调用方的选择状态 */
export type InlineLightboxBatchAction = 'download' | 'delete';

export interface InlineLightboxBatch {
  action: InlineLightboxBatchAction;
  /** 已勾选图片数 */
  count: number;
  /** 是否因加载中 / 处理中而禁止改动选择与执行 */
  disabled: boolean;
  /** 图片是否已勾选 */
  isSelected: (key: string) => boolean;
  /** 切换单张图片勾选状态 */
  toggle: (key: string) => void;
  /** 执行批量操作（确认弹窗等流程由调用方负责） */
  execute: () => void;
}

/** 灯箱响应式状态（模块级单例，组件与命令式调用方共享） */
export interface InlineLightboxState {
  open: boolean;
  src: string;
  snapshot?: InlinePromptSnapshot;
  onDownload?: () => void | Promise<void>;
  /** 当前图片在图片池中的 key；未使用图片池时为空 */
  key: string;
  /** 图片池；未传入时退化为单图模式 */
  gallery?: InlineLightboxGallery;
  /** 批量操作上下文；为空时大图仅支持预览与单张下载 */
  batch?: InlineLightboxBatch;
}

export const inlineLightboxState = reactive<InlineLightboxState>({ open: false, src: '', key: '' });

/**
 * 打开 Lightbox 大图预览弹窗（由 InlineImageLightbox 组件渲染）
 * @param src 初始图片地址
 * @param snapshot 初始提示词快照
 * @param actions Lightbox 操作集合
 */
export function openInlineImageLightbox(
  src: string,
  snapshot?: InlinePromptSnapshot,
  actions?: InlineLightboxActions,
): void {
  inlineLightboxState.src = src;
  inlineLightboxState.snapshot = snapshot;
  inlineLightboxState.onDownload = actions?.onDownload;
  inlineLightboxState.key = '';
  inlineLightboxState.gallery = undefined;
  inlineLightboxState.batch = undefined;
  inlineLightboxState.open = true;
}

/**
 * 打开带图片池的 Lightbox：可左右翻页，并按需附带批量勾选上下文
 * @param gallery 图片池
 * @param key 初始图片 key
 * @param options 批量操作上下文
 */
export function openInlineImageGalleryLightbox(
  gallery: InlineLightboxGallery,
  key: string,
  options?: { batch?: InlineLightboxBatch },
): void {
  inlineLightboxState.src = gallery.srcOf(key);
  inlineLightboxState.snapshot = gallery.snapshotOf(key);
  inlineLightboxState.onDownload = undefined;
  inlineLightboxState.key = key;
  inlineLightboxState.gallery = gallery;
  inlineLightboxState.batch = options?.batch;
  inlineLightboxState.open = true;
  gallery.ensure(key);
}

/**
 * 关闭 Lightbox 大图预览弹窗
 */
export function closeInlineImageLightbox(): void {
  inlineLightboxState.open = false;
}

/**
 * 克隆为 IndexedDB 可结构化保存的纯提示词快照
 * @param snapshot 原始提示词快照
 * @returns 去除响应式代理引用后的快照
 */
export function cloneInlinePromptSnapshot(snapshot: InlinePromptSnapshot): InlinePromptSnapshot {
  return {
    ...(snapshot.positivePrompt !== undefined ? { positivePrompt: snapshot.positivePrompt } : {}),
    ...(snapshot.negativePrompt !== undefined ? { negativePrompt: snapshot.negativePrompt } : {}),
    imageSource: snapshot.imageSource,
    novelai: snapshot.novelai ? cloneNovelAIFinalPrompts(snapshot.novelai) : undefined,
    comfyui: snapshot.comfyui ? cloneComfyUIRequestSnapshot(snapshot.comfyui) : undefined,
    promptParts: snapshot.promptParts ? cloneInlinePromptParts(snapshot.promptParts) : undefined,
    ...(snapshot.novelaiRequest ? { novelaiRequest: { ...snapshot.novelaiRequest } } : {}),
    ...(snapshot.composition ? { composition: { ...snapshot.composition } } : {}),
  };
}

/**
 * 克隆提示词部件
 * @param parts 原始正负部件
 * @returns 纯对象部件
 */
function cloneInlinePromptParts(
  parts: NonNullable<InlinePromptSnapshot['promptParts']>,
): NonNullable<InlinePromptSnapshot['promptParts']> {
  return { positive: { ...parts.positive }, negative: { ...parts.negative } };
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
    ...(snapshot.loraNodes
      ? {
          loraNodes: snapshot.loraNodes.map(node => ({
            nodeId: node.nodeId,
            loras: node.loras.map(lora => ({ name: lora.name, strength: lora.strength })),
          })),
        }
      : {}),
    ...(snapshot.workflowPresetName !== undefined ? { workflowPresetName: snapshot.workflowPresetName } : {}),
    ...(snapshot.loraPresetName !== undefined ? { loraPresetName: snapshot.loraPresetName } : {}),
    ...(snapshot.resolution ? { resolution: { ...snapshot.resolution } } : {}),
    ...(snapshot.loraPresetId ? { loraPresetId: snapshot.loraPresetId } : {}),
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
