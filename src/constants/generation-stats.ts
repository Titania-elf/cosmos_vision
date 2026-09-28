import type { ImageSource } from '@/constants/comfyui';

/** 生图统计 localStorage 键(运行时数据,不进入 ST extension_settings) */
export const GENERATION_STATS_STORAGE_KEY = 'cosmos-vision:image-generation-stats';

/** 生图统计记录上限,超出后淘汰最旧记录 */
export const MAX_GENERATION_STATS_RECORDS = 200;

/** 单条内联生图请求记录 */
export interface ImageGenerationRecord {
  id: string;
  /** 图像生成来源 */
  source: ImageSource;
  /** 请求发起时间(epoch ms) */
  startedAt: number;
  /** 请求耗时(ms) */
  durationMs: number;
  /** 成功时的图片数量,失败为 0 */
  imageCount: number;
  success: boolean;
  /** 失败时的错误信息(截断) */
  errorMessage?: string;
}
