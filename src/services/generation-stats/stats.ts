import { z } from 'zod';

import { IMAGE_SOURCES, type ImageSource } from '@/constants/comfyui';
import { MAX_GENERATION_STATS_RECORDS, type ImageGenerationRecord } from '@/constants/generation-stats';

/** 单条记录的耗时摘要 */
export interface GenerationStatsSummary {
  total: number;
  success: number;
  failure: number;
  /** 平均耗时,仅基于成功记录;无成功记录时为 null */
  averageMs: number | null;
  fastestMs: number | null;
  slowestMs: number | null;
}

/** 全部记录的统计结果 */
export interface GenerationStatsResult {
  overall: GenerationStatsSummary;
  bySource: Record<ImageSource, GenerationStatsSummary>;
}

const imageSourceSchema = z.enum(
  IMAGE_SOURCES.map(option => option.value) as [ImageSource, ...ImageSource[]],
);

const imageGenerationRecordSchema = z.object({
  id: z.string().min(1),
  source: imageSourceSchema,
  startedAt: z.number().finite().nonnegative(),
  durationMs: z.number().finite().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

/**
 * 解析 localStorage 中的生图统计数据
 * 逐条校验,坏条目直接丢弃,避免单条脏数据拖垮整份记录
 * @param value 存储的原始值
 * @returns 可安全使用的记录列表
 */
export function parseStoredGenerationStats(value: unknown): ImageGenerationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const result = imageGenerationRecordSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

/**
 * 追加一条记录并应用数量上限(淘汰最旧)
 * @param records 现有记录(旧 → 新)
 * @param record 新记录
 * @returns 追加后的记录列表(旧 → 新)
 */
export function appendGenerationRecord(
  records: readonly ImageGenerationRecord[],
  record: ImageGenerationRecord,
): ImageGenerationRecord[] {
  const next = [...records, record];
  return next.length > MAX_GENERATION_STATS_RECORDS ? next.slice(next.length - MAX_GENERATION_STATS_RECORDS) : next;
}

/**
 * 计算生图统计摘要
 * 耗时(平均/最快/最慢)仅基于成功记录,失败多为超时,会扭曲耗时信号
 * @param records 生图记录
 * @returns 总体与按图像源的摘要
 */
export function computeGenerationStats(records: readonly ImageGenerationRecord[]): GenerationStatsResult {
  const overall = summarizeRecords(records);
  const bySource = Object.fromEntries(
    IMAGE_SOURCES.map(({ value }) => [value, summarizeRecords(records.filter(record => record.source === value))]),
  ) as Record<ImageSource, GenerationStatsSummary>;
  return { overall, bySource };
}

/**
 * 汇总单组记录
 * @param records 待汇总记录
 * @returns 摘要
 */
function summarizeRecords(records: readonly ImageGenerationRecord[]): GenerationStatsSummary {
  const succeeded = records.filter(record => record.success);
  const durations = succeeded.map(record => record.durationMs);
  return {
    total: records.length,
    success: succeeded.length,
    failure: records.length - succeeded.length,
    averageMs: durations.length > 0 ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : null,
    fastestMs: durations.length > 0 ? Math.min(...durations) : null,
    slowestMs: durations.length > 0 ? Math.max(...durations) : null,
  };
}

/**
 * 格式化耗时展示文案
 * @param ms 耗时毫秒
 * @returns 形如 "830 ms" / "12.4 s" / "2分31秒" 的文案
 */
export function formatGenerationDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes}分${restSeconds}秒`;
}

/**
 * 格式化记录时间戳展示文案
 * @param epochMs 请求发起时间(epoch ms)
 * @returns 本地化时间字符串
 */
export function formatGenerationTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}
