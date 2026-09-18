import { isNovelAIV3Model, isNovelAIV5Model, type CosmosVisionSettings } from '@/constants/novelai';
import { getAvailableNovelAIAccounts } from '@/services/novelai/router';
import {
  buildNovelAIFinalPrompts,
  buildNovelAIPromptOverrides,
  buildNovelAIResolvedRequestFromPrompts,
  generateNovelAIImagesFromResolvedRequest,
} from '@/services/novelai/api';
import { getActiveNovelAIVibePresetRefs } from '@/services/novelai/vibe-parameters';
import {
  buildComfyUIFinalPrompts,
  buildComfyUIResolvedRequestFromPrompts,
  getComfyUIRequestError,
} from '@/services/comfyui/request';
import { generateComfyUIImagesFromResolvedRequest } from '@/services/comfyui/api';
import { readImageBindings, readNodeMeta } from '@/services/comfyui/meta';
import { parseComfyUIWorkflow } from '@/services/comfyui/parse';
import { getActiveComfyUIWorkflowPreset } from '@/services/comfyui/workflow-presets';
import { isSupportedLoraNode } from '@/services/comfyui/lora-adapter';
import { isLinkRef } from '@/services/comfyui/link';
import { PublicApiError, throwIfAborted } from './errors';
import type { Capabilities, ImagePrompts, ImageSource, PromptDraft } from './types';
import type { PublicTask } from './tasks';

type SourceStatus = Capabilities['imageSources'][number];
const RUNTIME_INPUTS = new Set([
  'width',
  'height',
  'batch_size',
  'steps',
  'start_at_step',
  'end_at_step',
  'cfg',
  'guidance',
  'seed',
  'noise_seed',
  'sampler_name',
  'scheduler',
  'denoise',
  'filename_prefix',
]);

/** 固定对象顺序和双 32 位指纹；只公开不透明标识，不泄漏工作流内 URL 或凭据。 */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    left = Math.imul(left ^ text.charCodeAt(index), 0x01000193);
    right = Math.imul(right ^ text.charCodeAt(index), 0x85ebca6b);
  }
  return [left, right].map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => [key, canonical(value)]),
    );
  }
  return value;
}

/** 模型、拓扑、绑定或工作流身份改变失效；图幅、步数、种子、LoRA 等仍取当前配置。 */
export function getComfyUIModelId(settings: CosmosVisionSettings['comfyui']): string {
  const preset = getActiveComfyUIWorkflowPreset(settings.workflowPresets);
  const workflow = parseComfyUIWorkflow(preset.workflowJson);
  const nodes = Object.entries(workflow).map(([id, node]) => {
    const meta = readNodeMeta(node);
    const inputs = Object.fromEntries(
      Object.entries(node.inputs).filter(([key, value]) => {
        if (isLinkRef(value)) return true;
        if (meta.promptBindings?.[key] || meta.seedModes?.[key] || RUNTIME_INPUTS.has(key)) return false;
        return !isSupportedLoraNode(node);
      }),
    );
    return [
      id,
      {
        class_type: node.class_type,
        inputs,
        promptBindings: meta.promptBindings,
        imageBindings: meta.imageBindings,
        imageOutput: meta.imageOutput,
      },
    ];
  });
  return `comfyui-v1-${fingerprint(canonical({ preset: preset.id, nodes: Object.fromEntries(nodes) }))}`;
}

export function readImageSourceStatus(settings: CosmosVisionSettings, source: ImageSource): SourceStatus {
  if (source === 'novelai') {
    const configured = getAvailableNovelAIAccounts(settings.novelai).some(account => {
      try {
        return ['http:', 'https:'].includes(new URL(account.url).protocol);
      } catch {
        return false;
      }
    });
    return {
      id: source,
      label: 'NovelAI',
      ready: configured,
      model: settings.novelai.model,
      ...(!configured ? { reason: '请配置并启用 NovelAI 账号。' } : {}),
    };
  }
  try {
    const model = getComfyUIModelId(settings.comfyui);
    if (getComfyUIRequestError(settings.comfyui))
      return {
        id: source,
        label: 'ComfyUI',
        ready: false,
        model,
        reason: '请配置 ComfyUI 地址、工作流提示词绑定及输出节点。',
      };
    const preset = getActiveComfyUIWorkflowPreset(settings.comfyui.workflowPresets);
    const avatarBindings = readImageBindings(parseComfyUIWorkflow(preset.workflowJson));
    if (avatarBindings.length)
      return {
        id: source,
        label: 'ComfyUI',
        ready: false,
        model,
        reason: '当前工作流依赖角色或用户头像，不能用于仅含显式文本的小剧场配图。',
      };
    return { id: source, label: 'ComfyUI', ready: true, model };
  } catch {
    return { id: source, label: 'ComfyUI', ready: false, model: '', reason: '请配置有效的 ComfyUI 工作流。' };
  }
}

export function requireImageSource(settings: CosmosVisionSettings, source: ImageSource): SourceStatus {
  if (source === 'comfyui') {
    try {
      const preset = getActiveComfyUIWorkflowPreset(settings.comfyui.workflowPresets);
      if (readImageBindings(parseComfyUIWorkflow(preset.workflowJson)).length) {
        throw new PublicApiError(
          'UNSUPPORTED_CONTEXT',
          'ComfyUI 工作流依赖当前角色或用户头像；请取消头像绑定后再使用小剧场配图。',
        );
      }
    } catch (error) {
      if (error instanceof PublicApiError) throw error;
      throw new PublicApiError('PROVIDER_NOT_CONFIGURED', '请配置有效的 ComfyUI 工作流。');
    }
  }
  const status = readImageSourceStatus(settings, source);
  if (!status.ready) throw new PublicApiError('PROVIDER_NOT_CONFIGURED', status.reason!);
  return status;
}

export function checkCharacterSupport(
  settings: CosmosVisionSettings,
  source: ImageSource,
  prompts: ImagePrompts,
  fromLlm = false,
): void {
  if (prompts.characterPrompts.length && (source === 'comfyui' || isNovelAIV3Model(settings.novelai.model))) {
    throw new PublicApiError(
      fromLlm ? 'INVALID_RESPONSE' : 'INVALID_REQUEST',
      '当前图像来源不支持独立人物提示词，请将人物描述写入正向提示词。',
    );
  }
}

export function finalizeImagePrompts(
  settings: CosmosVisionSettings,
  source: ImageSource,
  prompts: ImagePrompts,
): ImagePrompts {
  checkCharacterSupport(settings, source, prompts, true);
  const final =
    source === 'novelai'
      ? buildNovelAIFinalPrompts(
          settings.novelai,
          settings.imagePromptPresets,
          settings.promptLlm,
          buildNovelAIPromptOverrides(prompts, prompts.characterPrompts),
          settings.artistTagPool,
        )
      : buildComfyUIFinalPrompts(settings.comfyui, settings.imagePromptPresets, prompts, settings.artistTagPool);
  return {
    positivePrompt: final.positivePrompt,
    negativePrompt: final.negativePrompt,
    characterPrompts: prompts.characterPrompts,
  };
}

export async function generatePublicImage(
  settings: CosmosVisionSettings,
  draft: PromptDraft,
  task: PublicTask,
): Promise<{ blobs: Blob[]; seed?: number }> {
  checkCharacterSupport(settings, draft.imageSource, draft.prompts);
  throwIfAborted(task.signal);
  if (draft.imageSource === 'novelai') {
    const request = buildNovelAIResolvedRequestFromPrompts(settings.novelai, {
      ...draft.prompts,
      characterCoordinateSpace: 'normalized',
      vibeReferences: isNovelAIV5Model(settings.novelai.model)
        ? []
        : getActiveNovelAIVibePresetRefs(settings.novelai.novelAIVibePresets),
    });
    const result = await generateNovelAIImagesFromResolvedRequest(request, 1, {
      signal: task.signal,
      allowAccountFallback: false,
      onDownloading: () => task.progress('downloading'),
    });
    return { blobs: result.imageBlobs.slice(0, 1), seed: result.snapshot.seed };
  }
  const request = buildComfyUIResolvedRequestFromPrompts(settings.comfyui, draft.prompts, {
    appendLoraTriggerWords: false,
    batchSize: 1,
  });
  const blobs = await generateComfyUIImagesFromResolvedRequest(settings.comfyui, request, {
    signal: task.signal,
    interruptOnAbort: false,
    maxImages: 1,
    onDownloading: () => task.progress('downloading'),
  });
  const seeds = request.snapshot.seedValues.map(seed => seed.value);
  return {
    blobs: blobs.slice(0, 1),
    ...(seeds.length && seeds.every(seed => seed === seeds[0]) ? { seed: seeds[0] } : {}),
  };
}
