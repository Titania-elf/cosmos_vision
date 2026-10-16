import type {
  ImageCompositionSettings,
  ImageCompositionSnapshot,
  ImageOrientation,
} from '@/constants/image-composition';
import { DEFAULT_IMAGE_COMPOSITION_PROMPT } from '@/constants/image-composition';
import { NOVELAI_IMAGE_SIZE_LIMITS } from '@/constants/novelai';

export function readImageOrientation(value: unknown): ImageOrientation | undefined {
  return value === 'portrait' || value === 'landscape' || value === 'square' ? value : undefined;
}

/** 提示词与构图共用同一份最终输出；保留单输出响应的外部标签以兼容旧正则。 */
export function selectFinalPromptOutput(rawText: string): string {
  const clean = rawText.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?(?:<\/think(?:ing)?\s*>|$)/gi, '');
  const blocks = [...clean.matchAll(/<output>([\s\S]*?)<\/output>/gi)];
  return blocks.length > 1 ? blocks.at(-1)![0] : clean;
}

/** 只读取最终输出块，避免推理或角色提示词里的同名字段改变构图。 */
export function extractImageOrientation(rawText: string): ImageOrientation | undefined {
  const finalOutput = selectFinalPromptOutput(rawText);
  const content = (finalOutput.match(/<output>([\s\S]*?)<\/output>/i)?.[1] ?? finalOutput)
    .trim()
    .replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1');
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return readImageOrientation((parsed as Record<string, unknown>).orientation);
    }
    return undefined;
  } catch {
    if (/^[{[]/.test(content)) return undefined;
    // 老预设可能仍返回非 JSON 标签；只接收独立的 orientation 行。
    const match = content.match(/^\s*(?:"orientation"|orientation)\s*:\s*"?(portrait|landscape|square)"?\s*,?\s*$/im);
    return readImageOrientation(match?.[1]);
  }
}

export function buildCompositionInstruction(settings?: ImageCompositionSettings): string {
  if (!settings?.enabled) return '';
  const prompt = settings.prompt.trim() || DEFAULT_IMAGE_COMPOSITION_PROMPT;
  return `${prompt}\n\n构图输出约定：在本次最终输出 JSON 的顶层增加 "orientation"，值只能为 "portrait"、"landscape" 或 "square"。保留现有正负提示词、角色数组及输出包裹格式；本约定补充此前的输出示例。所选方向必须与提示词中的镜头、主体姿态和空间安排一致。`;
}

export function isValidCompositionSize(size?: {
  width: number;
  height: number;
}): size is { width: number; height: number } {
  return (
    !!size &&
    [size.width, size.height].every(
      value => Number.isInteger(value) && value >= 64 && value <= 4096 && value % 64 === 0,
    )
  );
}

/** 只为本次请求选择尺寸；缺失方向或无效尺寸时沿用调用方的当前设置。 */
export function resolveImageComposition(
  settings: ImageCompositionSettings | undefined,
  orientation: ImageOrientation | undefined,
  currentSize: { width: number; height: number },
): ImageCompositionSnapshot | undefined {
  if (!settings?.enabled || !orientation) return undefined;
  let size: { width: number; height: number };
  if (settings.sizeMode === 'swap') {
    if (!isValidCompositionSize(currentSize)) return undefined;
    const short = Math.min(currentSize.width, currentSize.height);
    const long = Math.max(currentSize.width, currentSize.height);
    if (orientation === 'square') {
      const edge = Math.round(Math.sqrt(short * long) / 64) * 64;
      size = { width: edge, height: edge };
    } else {
      if (short === long) return undefined;
      size = orientation === 'portrait' ? { width: short, height: long } : { width: long, height: short };
    }
  } else {
    size = settings.sizes[orientation];
  }
  if (!isValidCompositionSize(size)) return undefined;
  if (orientation === 'portrait' && size.width >= size.height) return undefined;
  if (orientation === 'landscape' && size.width <= size.height) return undefined;
  if (orientation === 'square' && size.width !== size.height) return undefined;
  return { orientation, width: size.width, height: size.height };
}

/** NovelAI 的边长上限低于通用 ComfyUI 配置，超出时沿用当前尺寸。 */
export function resolveNovelAIImageComposition(
  settings: ImageCompositionSettings | undefined,
  orientation: ImageOrientation | undefined,
  currentSize: { width: number; height: number },
): ImageCompositionSnapshot | undefined {
  const composition = resolveImageComposition(settings, orientation, currentSize);
  return composition &&
    composition.width <= NOVELAI_IMAGE_SIZE_LIMITS.max &&
    composition.height <= NOVELAI_IMAGE_SIZE_LIMITS.max
    ? composition
    : undefined;
}
