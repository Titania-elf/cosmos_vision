import { z } from 'zod';
import { PublicApiError } from './errors';
import type { GenerateRequest, PreparePromptRequest, PromptDraft, RequestControl } from './types';

/** 按 JavaScript 字符串长度计数，包括正文、显式资料、历史和本次要求。 */
export const MAX_TEXT_CHARS = 100_000;
export const MAX_IMAGES = 1;
const nonblank = z.string().refine(value => Boolean(value.trim()));
const identifier = nonblank.max(256);
const source = z.enum(['novelai', 'comfyui']);

export const sceneSchema = z.object({ summary: nonblank });
export const characterPromptSchema = z.object({
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
});
export const imagePromptsSchema = z.object({
  positivePrompt: nonblank,
  negativePrompt: z.string(),
  characterPrompts: z.array(characterPromptSchema),
});
const draftSchema = z.object({
  version: z.literal(1),
  imageSource: source,
  model: nonblank.max(256),
  scene: sceneSchema,
  prompts: imagePromptsSchema,
});
const prepareSchema = z.object({
  mode: z.literal('theater'),
  imageSource: source,
  presetId: identifier.optional(),
  theaterText: nonblank,
  context: z.object({
    mode: z.literal('provided'),
    source: z.object({ client: z.literal('titania-theater'), sceneId: identifier }),
    participants: z.string(),
    history: z.array(z.string()),
  }),
  specialRequest: z.string(),
  previousScenes: z.array(sceneSchema).optional(),
});
const generateSchema = z.object({ draft: draftSchema, count: z.literal(MAX_IMAGES) });

function checkTextLength(values: readonly string[]): void {
  if (values.reduce((total, text) => total + text.length, 0) > MAX_TEXT_CHARS) {
    throw new PublicApiError(
      'TEXT_TOO_LONG',
      `本次文本合计超过 ${MAX_TEXT_CHARS} 个字符，请缩短后重试；正文未被截断。`,
    );
  }
}

/** Zod 只拷贝已声明的字段；调用方附带的私有字段不会流入公开结果。 */
export function validatePrepareRequest(input: unknown): PreparePromptRequest {
  if (isRecord(input) && input.mode !== undefined && input.mode !== 'theater') {
    throw new PublicApiError('UNSUPPORTED_MODE', '当前公开接口仅支持小剧场配图。');
  }
  if (isRecord(input) && isRecord(input.context) && input.context.mode !== 'provided') {
    throw new PublicApiError('UNSUPPORTED_CONTEXT', '请显式提供 provided 上下文。');
  }
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) throw new PublicApiError('INVALID_REQUEST', '小剧场请求参数不完整或格式不正确。');
  const request = parsed.data;
  checkTextLength([
    request.theaterText,
    request.context.participants,
    ...request.context.history,
    request.specialRequest,
    ...(request.previousScenes ?? []).map(scene => scene.summary),
  ]);
  return request;
}

export function validateDraft(input: unknown): PromptDraft {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) throw new PublicApiError('INVALID_REQUEST', '提示词草稿格式不正确，人物坐标须在 0–1 范围内。');
  const draft = parsed.data;
  draft.prompts.positivePrompt = draft.prompts.positivePrompt.trim();
  draft.prompts.negativePrompt = draft.prompts.negativePrompt.trim();
  for (const character of draft.prompts.characterPrompts) {
    character.positivePrompt = character.positivePrompt.trim();
    character.negativePrompt = character.negativePrompt.trim();
  }
  checkTextLength([
    draft.scene.summary,
    draft.prompts.positivePrompt,
    draft.prompts.negativePrompt,
    ...draft.prompts.characterPrompts.flatMap(character => [character.positivePrompt, character.negativePrompt]),
  ]);
  return draft;
}

export function validateGenerateRequest(input: unknown): GenerateRequest {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success)
    throw new PublicApiError('INVALID_REQUEST', '请提供有效的提示词草稿；1.0 版每次仅支持生成 1 张图片。');
  return { draft: validateDraft(parsed.data.draft), count: MAX_IMAGES };
}

export function validateControl(input: RequestControl): RequestControl {
  if (!isRecord(input) || !identifier.safeParse(input.requestId).success) {
    throw new PublicApiError('INVALID_REQUEST', '请为每次调用提供非空且不超过 256 个字符的 requestId。');
  }
  const signal = input.signal;
  if (
    signal !== undefined &&
    (!signal ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  )
    throw new PublicApiError('INVALID_REQUEST', 'signal 必须是 AbortSignal。');
  if (input.onProgress !== undefined && typeof input.onProgress !== 'function') {
    throw new PublicApiError('INVALID_REQUEST', 'onProgress 必须是函数。');
  }
  return { requestId: input.requestId, signal, onProgress: input.onProgress };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
