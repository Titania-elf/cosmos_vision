import { normalizeLoraManagerName } from '@/services/comfyui/lora-adapter';
import { dedupeTriggerWords } from '@/services/comfyui/lora-presets';
import { normalizeComfyUIUrl } from '@/services/comfyui/parse';

/**
 * ComfyUI-Lora-Manager 触发词接口
 * 该插件的路由挂在 ComfyUI 自身的 aiohttp 服务上，与生图接口同源同端口。
 * 触发词来自模型旁 `<model>.metadata.json` 的 `civitai.trainedWords`（Civitai 元数据或用户在管理器内手填）。
 */
const LORA_MANAGER_TRIGGER_WORDS_PATH = '/api/lm/loras/get-trigger-words';

/** 接口 404 时的提示（未装 / 未启用 ComfyUI-Lora-Manager） */
const LORA_MANAGER_MISSING_MESSAGE =
  'ComfyUI 未提供 LoRA Manager 触发词接口（404），请确认已安装并启用 ComfyUI-Lora-Manager';

/** 批量拉取的并发上限，避免一次性打满 ComfyUI */
const TRIGGER_WORDS_FETCH_CONCURRENCY = 6;

/** 单个 LoRA 拉取失败的原因 */
export interface ComfyUILoraTriggerWordsFailure {
  name: string;
  message: string;
}

/** 批量拉取触发词的结果 */
export interface ComfyUILoraTriggerWordsBatchResult {
  /** LoRA 名称（与传入值一致）→ 触发词列表，仅含拉取成功的条目 */
  triggerWords: Map<string, string[]>;
  /** 拉取失败的条目 */
  failures: ComfyUILoraTriggerWordsFailure[];
}

/**
 * 从 LoRA Manager 读取单个 LoRA 的触发词
 * @param comfyuiUrl ComfyUI 地址
 * @param loraName LoRA 名称（可带子目录与扩展名，内部会规范化）
 * @returns 触发词列表；该 LoRA 没有记录触发词时为空数组
 */
export async function fetchComfyUILoraTriggerWords(comfyuiUrl: string, loraName: string): Promise<string[]> {
  const baseUrl = normalizeComfyUIUrl(comfyuiUrl);
  const name = normalizeLoraManagerName(loraName);
  if (!name) return [];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${LORA_MANAGER_TRIGGER_WORDS_PATH}?name=${encodeURIComponent(name)}`);
  } catch (error) {
    throw new Error(`[ComfyUI ${LORA_MANAGER_TRIGGER_WORDS_PATH}] ${(error as Error).message}`);
  }

  if (response.status === 404) throw new Error(LORA_MANAGER_MISSING_MESSAGE);
  if (!response.ok) {
    throw new Error(`LoRA Manager 触发词接口请求失败 (${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('LoRA Manager 触发词接口响应不是有效的 JSON');
  }
  if (!isRecord(payload)) throw new Error('LoRA Manager 触发词接口响应结构无效');
  if (payload.success === false) {
    throw new Error(readTrimmedString(payload.error) ?? 'LoRA Manager 未能返回该 LoRA 的触发词');
  }
  return parseLoraManagerTriggerWords(payload.trigger_words);
}

/**
 * 并发拉取多个 LoRA 的触发词，单条失败不影响其余条目
 * @param comfyuiUrl ComfyUI 地址
 * @param loraNames LoRA 名称列表（自动去重、忽略空名）
 * @returns 成功的触发词映射与失败明细
 */
export async function fetchComfyUILoraTriggerWordsBatch(
  comfyuiUrl: string,
  loraNames: readonly string[],
): Promise<ComfyUILoraTriggerWordsBatchResult> {
  // 提前校验地址，避免每个条目各抛一次「请先填写 ComfyUI URL」
  const baseUrl = normalizeComfyUIUrl(comfyuiUrl);
  // 名称按原样区分大小写去重（Linux 下同名不同大小写是两个文件），便于调用方按 name 回查
  const targets = Array.from(new Set(loraNames.map(name => name.trim()).filter(Boolean)));
  const triggerWords = new Map<string, string[]>();
  const failures: ComfyUILoraTriggerWordsFailure[] = [];

  let cursor = 0;
  const workerCount = Math.min(TRIGGER_WORDS_FETCH_CONCURRENCY, targets.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < targets.length) {
        const name = targets[cursor++]!;
        try {
          triggerWords.set(name, await fetchComfyUILoraTriggerWords(baseUrl, name));
        } catch (error) {
          failures.push({ name, message: error instanceof Error ? error.message : '获取触发词失败' });
        }
      }
    }),
  );

  return { triggerWords, failures };
}

/**
 * 解析接口返回的 trigger_words 字段
 * 兼容字符串数组与单一字符串；Civitai 的 trainedWords 常把多个词写在同一项里，
 * 且 LoRA Manager 内部用 `,, ` 连接，故统一按逗号/换行拆分（与手填输入框一致）。
 * @param value 原始 trigger_words 值
 * @returns 规范化后的触发词列表
 */
export function parseLoraManagerTriggerWords(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  const words: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    words.push(...item.split(/[,\n]+/));
  }
  return dedupeTriggerWords(words);
}

/**
 * 读取非空字符串
 * @param value 原始值
 * @returns 字符串或 null
 */
function readTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 判断是否为普通对象
 * @param value 原始值
 * @returns 是否为对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
