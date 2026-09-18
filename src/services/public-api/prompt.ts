import { z } from 'zod';
import type { CosmosVisionSettings } from '@/constants/novelai';
import { getPromptLlmMessageEntryKind } from '@/constants/prompt-llm';
import { buildPromptLlmOrderedPrompts } from '@/services/prompt-llm/runtime-request';
import {
  getActivePromptLlmPreset,
  replacePromptLlmContentTokens,
  type resolvePromptLlmMessageContent,
} from '@/services/prompt-llm/message-preset';
import {
  buildJsonSchema,
  type TavernHelperJsonSchema,
  type TavernHelperRolePrompt,
} from '@/services/tavern-helper/prompt-llm';
import { PublicApiError } from './errors';
import { characterPromptSchema, sceneSchema } from './validation';
import type { ImagePrompts, PreparePromptRequest, SceneSelection } from './types';

const OUTPUT_RULES = `仅返回一个 JSON 对象（可以包裹在 <output> 中），字段固定为：
{"scene":{"summary":"一至三句中文画面描述","sourceExcerpt":"从本次 theater_text 连续逐字复制的原文"},"positivePrompt":"绘画正向提示词","negativePrompt":"绘画负向提示词","characterPrompts":[]}
characterPrompts 必须是数组。每个元素字段为 positivePrompt、negativePrompt、position:{x,y}，坐标范围 0–1。
无可选画面时返回 {"scene":null,"positivePrompt":"","negativePrompt":"","characterPrompts":[]}。
theater_text 是尚未选景的完整作品（预设的焦点段落槽位收到的就是它），不是已确定的焦点段落。只选一个同一时空的画面；不得拼贴，不返回推理过程。`;

/** supplied-only：只解析本次显式提供的上下文，不读取世界书或当前聊天。 */
const resolveProvidedMessage: typeof resolvePromptLlmMessageContent = async (message, content) => {
  if (getPromptLlmMessageEntryKind(message) !== 'custom' || message.reference) {
    throw new PublicApiError(
      'UNSUPPORTED_CONTEXT',
      '小剧场预设不能读取世界书引用，请将需要的资料通过 participants 或 history 提供。',
    );
  }
  const template = message.content.replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
  // 其余宏形文本（含内置预设里的 {{tag}} 示例）保持字面；EJS 需要当前聊天资料，直接拒绝。
  if (/<%/.test(template)) {
    throw new PublicApiError('UNSUPPORTED_CONTEXT', '小剧场预设不支持 EJS 模板；请改用显式提供的资料。');
  }
  return replacePromptLlmContentTokens(template, content);
};

/**
 * 解析本次使用的提示词预设
 * @param settings 扩展设置
 * @param presetId 调用方指定预设；缺省时用当前激活预设（默认即内置预设）
 * @returns 本次预设
 */
function resolveTheaterPreset(
  settings: CosmosVisionSettings,
  presetId?: string,
): ReturnType<typeof getActivePromptLlmPreset> {
  if (!presetId) return getActivePromptLlmPreset(settings.promptLlmMessagePresets);
  const preset = settings.promptLlmMessagePresets.presets.find(item => item.id === presetId);
  if (!preset) throw new PublicApiError('INVALID_REQUEST', '未找到本次指定的提示词预设。');
  return preset;
}

export async function buildTheaterMessages(
  settings: CosmosVisionSettings,
  request: PreparePromptRequest,
  model: string,
): Promise<TavernHelperRolePrompt[]> {
  const preset = resolveTheaterPreset(settings, request.presetId);
  const messages = await buildPromptLlmOrderedPrompts(
    { activePresetId: preset.id, presets: [preset] },
    {
      participantContent: request.context.participants,
      historyContent: request.context.history.join('\n\n'),
      // 内置预设把焦点段落当作 <main_scene>。小剧场传入的是整篇正文，选景要求由输出规则说明。
      focusParagraphContent: request.theaterText,
      specialRequestContent: request.specialRequest,
      theaterTextContent: request.theaterText,
      previousScenesContent: JSON.stringify(request.previousScenes ?? []),
    },
    { imageSource: request.imageSource, modelId: model, historyContent: request.context.history.join('\n\n') },
    resolveProvidedMessage,
  );
  return [
    ...messages,
    { role: 'system', content: `${OUTPUT_RULES}\n本次图像来源：${request.imageSource}；模型：${model}。` },
    {
      role: 'user',
      // 即便用户预设不含输入宏，也必须完整提交正文。sceneId 不用于查询或提示词补齐。
      content: JSON.stringify({
        theater_text: request.theaterText,
        participants: request.context.participants,
        history: request.context.history,
        special_request: request.specialRequest,
        previous_scenes: request.previousScenes ?? [],
      }),
    },
  ];
}

export function buildTheaterJsonSchema(): TavernHelperJsonSchema {
  const base = buildJsonSchema();
  return {
    ...base,
    name: 'cosmos_vision_theater_output',
    description: '小剧场单幅画面选择与最终绘画内容',
    value: {
      ...base.value,
      properties: {
        ...(base.value.properties as Record<string, unknown>),
        characterPrompts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              positivePrompt: { type: 'string' },
              negativePrompt: { type: 'string' },
              position: {
                type: 'object',
                properties: {
                  x: { type: 'number', minimum: 0, maximum: 1 },
                  y: { type: 'number', minimum: 0, maximum: 1 },
                },
                required: ['x', 'y'],
                additionalProperties: false,
              },
            },
            required: ['positivePrompt', 'negativePrompt', 'position'],
            additionalProperties: false,
          },
        },
        scene: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                summary: { type: 'string', description: '一至三句中文画面描述' },
                sourceExcerpt: { type: 'string', description: 'theater_text 中连续、逐字一致的原文' },
              },
              required: ['summary', 'sourceExcerpt'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: [...(base.value.required as string[]), 'scene'],
    },
  };
}

const outputSchema = z.object({
  scene: sceneSchema.nullable(),
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  characterPrompts: z.array(characterPromptSchema),
});

export function extractTheaterResult(
  rawText: string,
  theaterText: string,
): { scene: SceneSelection; prompts: ImagePrompts } {
  let text = rawText.trim();
  const outputs = [...text.matchAll(/<output>\s*([\s\S]*?)\s*<\/output>/gi)];
  if (outputs.length > 1) throw new PublicApiError('INVALID_RESPONSE', '提示词模型返回了多个结果，请重新分析。');
  if (outputs.length === 1) text = outputs[0]![1]!.trim();
  text = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PublicApiError('INVALID_RESPONSE', '提示词模型未返回有效 JSON，请重新分析。');
  }
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) throw new PublicApiError('INVALID_RESPONSE', '提示词模型返回的画面或人物提示词格式不正确。');
  const { scene, ...prompts } = parsed.data;
  if (scene === null) throw new PublicApiError('NO_SCENE', '未能从正文中确定有依据的画面，请补充内容或调整本次要求。');
  if (!prompts.positivePrompt.trim() || !theaterText.includes(scene.sourceExcerpt)) {
    throw new PublicApiError('INVALID_RESPONSE', '提示词为空或画面摘录不是正文中的连续原文，请重新分析。');
  }
  return { scene, prompts };
}
