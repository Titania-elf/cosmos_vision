import type { ArtistTagPoolSettings } from '@/constants/artist-tag';
import type { ComfyUISettings } from '@/constants/comfyui';
import type { ImagePromptPresetSettings } from '@/constants/image-prompt';
import { pickRandomArtistTag, prependArtistTag } from '@/services/image-prompt/artist-tag-pool';
import { buildImagePromptPair, type ImagePromptPair } from '@/services/image-prompt/presets';
import { readLoraSnapshotsFromWorkflow, writeLoraPresetToNode, isSupportedLoraNode } from '@/services/comfyui/lora-adapter';
import { getActiveComfyUILoraPreset, getActiveComfyUILoraTriggerWords, prependLoraTriggerWords } from '@/services/comfyui/lora-presets';
import {
  readImageBindings,
  readImageOutputNodeId,
  readPromptBindings,
  stripCosmosVisionMeta,
  validateImageBindings,
  validateImageOutput,
  validatePromptBindings,
} from '@/services/comfyui/meta';
import { getComfyUIWorkflowValidationError, normalizeComfyUIUrl, parseComfyUIWorkflow } from '@/services/comfyui/parse';
import { applySeedModes } from '@/services/comfyui/seed-runtime';
import { getCachedComfyUIObjectInfo } from '@/services/comfyui/object-info';
import { listResolutionTargets } from '@/services/comfyui/resolution-combos';
import { getActiveComfyUIWorkflowJson, getActiveComfyUIWorkflowPreset } from '@/services/comfyui/workflow-presets';
import type {
  ComfyUIRequestSnapshot,
  ComfyUIResolvedRequest,
  ComfyUIWorkflow,
} from '@/services/comfyui/types';

/**
 * 按共享生图预设解析并构建 ComfyUI 最终请求
 * @param settings ComfyUI 设置
 * @param presetSettings 共享生图提示词预设
 * @param prompts 正负提示词覆写
 * @param artistTagPool 画师串池
 * @returns 可直接发送的工作流与快照
 */
export function buildComfyUIResolvedRequest(
  settings: ComfyUISettings,
  presetSettings: ImagePromptPresetSettings,
  prompts: ImagePromptPair,
  artistTagPool?: ArtistTagPoolSettings,
): ComfyUIResolvedRequest {
  const pair = buildImagePromptPair(presetSettings, settings, prompts);
  // 每次请求只抽一次画师串,前置到正向提示词最前面
  const positivePrompt = prependArtistTag(pair.positivePrompt, pickRandomArtistTag(artistTagPool));
  return buildComfyUIResolvedRequestFromPrompts(settings, { ...pair, positivePrompt });
}

/**
 * 使用最终正负提示词构建 ComfyUI 请求
 * @param settings ComfyUI 设置
 * @param prompts 已完成拼接的正负提示词
 * @returns 可直接发送的工作流与快照
 */
export function buildComfyUIResolvedRequestFromPrompts(
  settings: ComfyUISettings,
  prompts: ImagePromptPair,
): ComfyUIResolvedRequest {
  const workflowJson = getActiveComfyUIWorkflowJson(settings.workflowPresets);
  const source = parseAndValidateWorkflow(settings, workflowJson);
  const { positivePrompt, negativePrompt } = requirePromptPair(prompts);
  // 触发词前置到画师串之前：触发词 → 画师串 → 用户提示词
  const triggeredPositivePrompt = prependLoraTriggerWords(
    positivePrompt,
    getActiveComfyUILoraTriggerWords(settings.loraPresets),
  );
  const workflow = structuredClone(source) as ComfyUIWorkflow;
  // 激活 LoRA 预设是唯一事实源：每次请求覆写工作流中的兼容节点，
  // 保证切组/改强度后立即生效，不依赖面板是否曾写入工作流草稿
  applyActiveLoraPreset(workflow, settings.loraPresets);
  applyPromptBindings(workflow, triggeredPositivePrompt, negativePrompt);
  const seedValues = applySeedModes(workflow, workflowJson);
  const imageOutputNodeId = readImageOutputNodeId(workflow)!;
  const promptBindings = readPromptBindings(workflow);
  const imageBindings = readImageBindings(workflow);
  const loras = readLoraSnapshotsFromWorkflow(workflow);
  stripCosmosVisionMeta(workflow);
  const resolution = readWorkflowResolution(workflow);

  return {
    workflow,
    imageOutputNodeId,
    snapshot: {
      endpoint: normalizeComfyUIUrl(settings.url),
      positivePrompt: triggeredPositivePrompt,
      negativePrompt,
      imageOutputNodeId,
      promptBindings,
      seedValues,
      imageBindings,
      loras,
      workflowPresetName: getActiveComfyUIWorkflowPreset(settings.workflowPresets).name,
      loraPresetName: getActiveComfyUILoraPreset(settings.loraPresets).name,
      resolution,
    },
  };
}

/**
 * 读取工作流首个分辨率目标的当前尺寸（无尺寸节点时返回 undefined）
 * @param workflow 工作流
 * @returns 分辨率或 undefined
 */
function readWorkflowResolution(workflow: ComfyUIWorkflow): { width: number; height: number } | undefined {
  const target = listResolutionTargets(workflow)[0];
  return target ? { width: target.width, height: target.height } : undefined;
}

/**
 * 将激活 LoRA 预设写入工作流副本中的首个兼容节点
 * @param workflow 工作流副本
 * @param loraPresets LoRA 预设组集合
 */
function applyActiveLoraPreset(workflow: ComfyUIWorkflow, loraPresets: ComfyUISettings['loraPresets']): void {
  const node = Object.values(workflow).find(isSupportedLoraNode);
  if (!node) return;
  writeLoraPresetToNode(node, getActiveComfyUILoraPreset(loraPresets));
}

/**
 * 解析并校验工作流绑定与输出节点
 * @param settings ComfyUI 设置
 * @param workflowJson 工作流 JSON
 * @returns 已校验工作流
 */
function parseAndValidateWorkflow(
  settings: Pick<ComfyUISettings, 'url'>,
  workflowJson: string,
): ComfyUIWorkflow {
  const source = parseComfyUIWorkflow(workflowJson);
  const bindingError = validatePromptBindings(source);
  if (bindingError) throw new Error(bindingError);
  // 图片绑定校验：在线时用已同步 schema 校验目标输入是图片输入；离线时只校验存在性
  const imageBindingError = validateImageBindings(
    source,
    getCachedComfyUIObjectInfo(settings.url),
  );
  if (imageBindingError) throw new Error(imageBindingError);
  const outputError = validateImageOutput(source);
  if (outputError) throw new Error(outputError);
  return source;
}

/**
 * 读取并要求至少一个非空提示词
 * @param prompts 正负提示词
 * @returns 裁剪后的正负提示词
 */
function requirePromptPair(prompts: ImagePromptPair): ImagePromptPair {
  const positivePrompt = prompts.positivePrompt.trim();
  const negativePrompt = prompts.negativePrompt.trim();
  if (!positivePrompt && !negativePrompt) {
    throw new Error('正向提示词或负向提示词至少填写一个');
  }
  return { positivePrompt, negativePrompt };
}

/**
 * 读取 ComfyUI 请求前置校验错误
 * @param settings ComfyUI 设置
 * @returns 校验错误或 null
 */
export function getComfyUIRequestError(settings: Pick<ComfyUISettings, 'url' | 'workflowPresets'>): string | null {
  try {
    normalizeComfyUIUrl(settings.url);
    return getComfyUIWorkflowValidationError(getActiveComfyUIWorkflowJson(settings.workflowPresets));
  } catch (error) {
    return error instanceof Error ? error.message : 'ComfyUI 配置校验失败';
  }
}

/**
 * 将最终提示词写入全部绑定目标
 * @param workflow 工作流副本
 * @param positivePrompt 正向提示词
 * @param negativePrompt 负向提示词
 */
function applyPromptBindings(workflow: ComfyUIWorkflow, positivePrompt: string, negativePrompt: string): void {
  for (const target of readPromptBindings(workflow)) {
    const node = workflow[target.nodeId];
    if (!node) continue;
    const value = target.binding === 'positive' ? positivePrompt : negativePrompt;
    node.inputs[target.inputName] = value;
  }
}

export type { ComfyUIRequestSnapshot, ComfyUIResolvedRequest, ComfyUIWorkflow };
