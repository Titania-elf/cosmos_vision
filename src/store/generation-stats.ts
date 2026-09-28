import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed } from 'vue';

import type { ImageSource } from '@/constants/comfyui';
import { GENERATION_STATS_STORAGE_KEY, type ImageGenerationRecord } from '@/constants/generation-stats';
import {
  appendGenerationRecord,
  computeGenerationStats,
  parseStoredGenerationStats,
} from '@/services/generation-stats/stats';
import type { InlineGenerationBatchResult } from '@/composables/inlineGenerationInput';

/** 失败记录错误信息最大保留长度 */
const ERROR_MESSAGE_MAX_LENGTH = 200;

/**
 * 生图耗时统计 Store
 * 运行时统计数据仅存 localStorage(与 darkMode 同策略),不进入 ST extension_settings,
 * 避免污染设置弹窗的草稿 isDirty 流程
 */
export const useGenerationStatsStore = defineStore('cosmos_vision_generation_stats', () => {
  /** 生图记录(旧 → 新) */
  const records = useLocalStorage<ImageGenerationRecord[]>(
    GENERATION_STATS_STORAGE_KEY,
    [],
    { writeDefaults: false },
  );
  records.value = parseStoredGenerationStats(records.value);

  /** 统计摘要(总体 + 按图像源) */
  const summary = computed(() => computeGenerationStats(records.value));
  /** 最近记录(新 → 旧) */
  const recentRecords = computed(() => [...records.value].reverse());

  /**
   * 创建记录 ID
   * @returns 唯一 ID
   */
  function createRecordId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * 计时包装一次生图请求并记录结果
   * 仅统计内联生图的图像请求阶段;Prompt LLM 阶段、测试页生图不经过此入口
   * 用户主动取消(signal.aborted)不计入;每次重试计为一次新记录
   * @param source 图像生成来源
   * @param signal 会话取消信号
   * @param task 实际的图片生成任务
   * @returns 图片与提示词快照
   */
  async function recordGeneration(
    source: ImageSource,
    signal: AbortSignal,
    task: () => Promise<InlineGenerationBatchResult>,
  ): Promise<InlineGenerationBatchResult> {
    const startedAt = Date.now();
    const start = performance.now();
    try {
      const result = await task();
      records.value = appendGenerationRecord(records.value, {
        id: createRecordId(),
        source,
        startedAt,
        durationMs: performance.now() - start,
        imageCount: result.imageBlobs.length,
        success: true,
      });
      return result;
    } catch (error) {
      if (!signal.aborted) {
        records.value = appendGenerationRecord(records.value, {
          id: createRecordId(),
          source,
          startedAt,
          durationMs: performance.now() - start,
          imageCount: 0,
          success: false,
          errorMessage: error instanceof Error ? error.message.slice(0, ERROR_MESSAGE_MAX_LENGTH) : String(error),
        });
      }
      throw error;
    }
  }

  /**
   * 清空全部生图统计记录
   */
  function clearRecords(): void {
    records.value = [];
  }

  return {
    records,
    summary,
    recentRecords,
    recordGeneration,
    clearRecords,
  };
});
