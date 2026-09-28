/**
 * 生图方案切换弹窗的同页单例状态
 *
 * 与灯箱 (inlineImageLightbox) 同构：画廊命中「生图方案」按钮时写入状态，
 * 由 App.vue 中挂载的唯一 InlineGenerationSchemeDialog 读取渲染，避免每个画廊 mount 各建一份弹窗。
 */
import { reactive } from 'vue';

import type { InlinePromptSnapshot } from '@/composables/inlineImageLightbox';

interface GenerationSchemeDialogState {
  open: boolean;
  /** 触发弹窗的图片提示词快照（用于展示本图方案对比） */
  snapshot: InlinePromptSnapshot | null;
}

export const generationSchemeDialogState = reactive<GenerationSchemeDialogState>({
  open: false,
  snapshot: null,
});

/**
 * 打开生图方案切换弹窗
 * @param snapshot 触发弹窗的图片提示词快照
 */
export function openGenerationSchemeDialog(snapshot: InlinePromptSnapshot | null): void {
  generationSchemeDialogState.snapshot = snapshot;
  generationSchemeDialogState.open = true;
}

/**
 * 关闭生图方案切换弹窗
 */
export function closeGenerationSchemeDialog(): void {
  generationSchemeDialogState.open = false;
}
