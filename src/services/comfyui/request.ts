import type { ComfyUILoraPreset, ComfyUISettings } from '@/constants/comfyui';
import type { ImagePromptPresetSettings } from '@/constants/image-prompt';
import { buildImagePromptPair, type ImagePromptPair } from '@/services/image-prompt/presets';
import { readLoraNodeSnapshots, writeLoraPresetToNode } from '@/services/comfyui/lora-adapter';
import {
  listLoraNodeIds,
  resolveComfyUILoraNodeAssignments,
  type ComfyUILoraNodeAssignment,
} from '@/services/comfyui/lora-node-bindings';
import { getActiveComfyUILoraPreset, prependLoraTriggerWords } from '@/services/comfyui/lora-presets';
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
import { applyModelMatch } from '@/services/comfyui/model-loaders';
import { applySeedModes } from '@/services/comfyui/seed-runtime';
import { fetchComfyUIObjectInfo, getCachedComfyUIObjectInfo } from '@/services/comfyui/object-info';
import { getActiveComfyUIWorkflowJson, getActiveComfyUIWorkflowPreset } from '@/services/comfyui/workflow-presets';
import { listResolutionTargets } from '@/services/comfyui/resolution-combos';
import { ensureImageExportNode } from '@/services/comfyui/export-node';
import type {
  ComfyUILoraNodeSnapshot,
  ComfyUILoraSnapshot,
  ComfyUIObjectInfoMap,
  ComfyUIRequestSnapshot,
  ComfyUIResolvedRequest,
  ComfyUIWorkflow,
} from '@/services/comfyui/types';

/** 回放快照生成的 LoRA 预设组名 */
const LORA_PLAYBACK_PRESET_NAME = 'Playback';

/** 本次未向任何 LoRA 节点注入 LoRA 时的展示名 */
const LORA_NOT_INJECTED_NAME = '未注入';

/**
 * LoRA 覆写目标（带标记形式）
 * 旧调用方仍可直接传预设组或扁平快照列表，带标记形式用于区分「空快照」与「不写入任何节点」
 */
export type ComfyUILoraOverride =
  | { kind: 'preset'; preset: ComfyUILoraPreset }
  | { kind: 'flat'; loras: readonly ComfyUILoraSnapshot[] }
  | { kind: 'nodes'; nodes: readonly ComfyUILoraNodeSnapshot[] };

/** 本次的 LoRA 写入方案 */
interface ComfyUILoraPlan {
  assignments: ComfyUILoraNodeAssignment[];
  presetName: string;
}

/**
 * 将快照 LoRA 列表转换为等效预设组
 * @param loras 快照记录的 LoRA 列表
 * @returns 等效 LoRA 预设组
 */
export function createComfyUILoraPresetFromSnapshots(
  loras: readonly ComfyUILoraSnapshot[],
): ComfyUILoraPreset {
  return {
    id: 'playback-snapshot-loras',
    name: LORA_PLAYBACK_PRESET_NAME,
    loras: loras.map((lora, index) => ({
      id: `snapshot-lora-${index}`,
      name: lora.name,
      strength: lora.strength,
      enabled: true,
    })),
  };
}

/**
 * 解析待写入工作流的 LoRA 预设
 * 若提供显式预设或快照列表（即使为空）则直接使用，仅在缺省时回退至面板激活组
 * @param settings ComfyUI 设置
 * @param loraPresetOrSnapshots 显式 LoRA 预设组或快照列表
 * @returns 确定的 LoRA 预设组
 */
function resolveEffectiveLoraPreset(
  settings: Pick<ComfyUISettings, 'loraPresets'>,
  override?: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride,
): ComfyUILoraPreset {
  if (!override) return getActiveComfyUILoraPreset(settings.loraPresets);
  if (isTaggedLoraOverride(override)) {
    return override.kind === 'preset'
      ? override.preset
      : createComfyUILoraPresetFromSnapshots(override.kind === 'flat' ? override.loras : []);
  }
  if (isFlatLoraOverride(override)) return createComfyUILoraPresetFromSnapshots(override);
  return override;
}

/**
 * 判断是否为带标记的 LoRA 覆写
 * @param value 待判断的覆写值
 * @returns 是否为带标记的覆写
 */
function isTaggedLoraOverride(
  value: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride | undefined,
): value is ComfyUILoraOverride {
  return Boolean(value) && !Array.isArray(value) && 'kind' in (value as ComfyUILoraOverride);
}

/**
 * 判断是否为（旧式）扁平快照列表
 * @param value 待判断的覆写值
 * @returns 是否为扁平快照列表
 */
function isFlatLoraOverride(
  value: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride | undefined,
): value is readonly ComfyUILoraSnapshot[] {
  return Array.isArray(value);
}

/**
 * 解析待存入快照的 LoRA 预设组 ID
 * 只有指向设置内真实预设组时才记录；回放/临时合成的组一律不记录，
 * 否则重新生图时会按组 ID 展开，把按节点绑定或回放快照压平
 * @param effectiveLoraPreset 生效的 LoRA 预设组
 * @param loraOverride 传入的显式覆写（预设组 / 扁平快照 / 带标记覆写）
 * @returns 真实预设组 ID，合成组或无显式组时返回 undefined
 */
function resolveSnapshotLoraPresetId(
  effectiveLoraPreset: ComfyUILoraPreset,
  loraOverride?: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride,
): string | undefined {
  if (!loraOverride) return effectiveLoraPreset.id;
  if (isTaggedLoraOverride(loraOverride)) {
    // 带标记的覆写里只有 kind='preset' 指向真实设置组，flat / nodes 均为合成组
    return loraOverride.kind === 'preset' ? loraOverride.preset.id : undefined;
  }
  if (isFlatLoraOverride(loraOverride)) return undefined;
  return loraOverride.id;
}

/**
 * 按共享生图预设解析并构建 ComfyUI 最终请求
 * @param settings ComfyUI 设置
 * @param presetSettings 共享生图提示词预设
 * @param prompts 正负提示词覆写
 * @param loraTriggerWords 本次生效 LoRA 的触发词
 * @param presetIds 本次实际使用的预设 ID（随机池抽中或面板当前），缺省用设置内引用
 * @param loraOverride 显式指定的 LoRA 覆写（预设组 / 扁平快照 / 按节点分组快照）；缺省按节点绑定解析
 * @returns 可直接发送的工作流与快照
 */
export async function buildComfyUIResolvedRequest(
  settings: ComfyUISettings,
  presetSettings: ImagePromptPresetSettings,
  prompts: ImagePromptPair,
  loraTriggerWords: readonly string[] = [],
  presetIds?: { positive: string; negative: string },
  loraOverride?: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride,
): Promise<ComfyUIResolvedRequest> {
  const references = presetIds
    ? { positivePromptPresetId: presetIds.positive, negativePromptPresetId: presetIds.negative }
    : settings;
  return buildComfyUIResolvedRequestFromPrompts(
    settings,
    buildImagePromptPair(presetSettings, references, prompts),
    loraTriggerWords,
    loraOverride,
  );
}

/**
 * 使用最终正负提示词构建 ComfyUI 请求（若 object_info 缓存 miss 则在线补拉，失败则降级）
 * @param settings ComfyUI 设置
 * @param prompts 已完成拼接的正负提示词
 * @param loraTriggerWords 本次生效 LoRA 的触发词
 * @param loraOverride 显式指定的 LoRA 覆写（预设组 / 旧扁平快照 / 按节点分组快照）；缺省按节点绑定解析
 * @returns 可直接发送的工作流与快照
 */
export async function buildComfyUIResolvedRequestFromPrompts(
  settings: ComfyUISettings,
  prompts: ImagePromptPair,
  loraTriggerWords: readonly string[] = [],
  loraOverride?: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride,
): Promise<ComfyUIResolvedRequest> {
  const objectInfo = getCachedComfyUIObjectInfo(settings.url) ?? await fetchComfyUIObjectInfo(settings.url).catch(() => null);
  const workflowJson = getActiveComfyUIWorkflowJson(settings.workflowPresets);
  const source = parseAndValidateWorkflow(workflowJson, objectInfo);
  const { positivePrompt, negativePrompt } = requirePromptPair(prompts);
  const workflow = structuredClone(source) as ComfyUIWorkflow;
  const loraPlan = resolveLoraPlan(workflow, settings, loraOverride);
  applyLoraPlan(workflow, loraPlan);
  const hasLoraNode = loraPlan.assignments.length > 0;
  applyModelMatch(workflow);
  // 仅当工作流确实承载了生效 LoRA 时才前置触发词，避免未加载的 LoRA 污染提示词
  const triggeredPositivePrompt = hasLoraNode
    ? prependLoraTriggerWords(positivePrompt, loraTriggerWords)
    : positivePrompt;
  applyPromptBindings(workflow, triggeredPositivePrompt, negativePrompt);
  const seedValues = applySeedModes(workflow, workflowJson);
  const imageOutputNodeId = readImageOutputNodeId(workflow)!;
  const exportNodeId = ensureImageExportNode(workflow, imageOutputNodeId, objectInfo);
  const promptBindings = readPromptBindings(workflow);
  const imageBindings = readImageBindings(workflow);
  // 只回读真正写入过的节点，避免把工作流内嵌的 LoRA 记成本插件注入
  const loraNodes = readLoraNodeSnapshots(
    workflow,
    loraPlan.assignments.map(assignment => assignment.nodeId),
  );
  const resolution = readWorkflowResolution(workflow);
  // 记录指向真实设置组的 ID，供「编辑 tag 后重新生图」弹窗回填；合成组不记录
  const effectiveLoraPreset = resolveEffectiveLoraPreset(settings, loraOverride);
  const loraPresetId = resolveSnapshotLoraPresetId(effectiveLoraPreset, loraOverride);
  stripCosmosVisionMeta(workflow);

  return {
    workflow,
    imageOutputNodeId: exportNodeId,
    snapshot: {
      endpoint: normalizeComfyUIUrl(settings.url),
      positivePrompt: triggeredPositivePrompt,
      negativePrompt,
      imageOutputNodeId,
      promptBindings,
      seedValues,
      imageBindings,
      loras: loraNodes.flatMap(node => node.loras),
      loraNodes,
      workflowPresetName: getActiveComfyUIWorkflowPreset(settings.workflowPresets).name,
      loraPresetName: summarizeLoraPresetNames(loraPlan.assignments),
      resolution,
      ...(loraPresetId ? { loraPresetId } : {}),
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
 * 解析并校验工作流绑定与输出节点
 * @param workflowJson 工作流 JSON
 * @param objectInfo 节点 schema 表
 * @returns 已校验工作流
 */
function parseAndValidateWorkflow(
  workflowJson: string,
  objectInfo: ComfyUIObjectInfoMap | null,
): ComfyUIWorkflow {
  const source = parseComfyUIWorkflow(workflowJson);
  const bindingError = validatePromptBindings(source);
  if (bindingError) throw new Error(bindingError);
  // 图片绑定校验：在线时用已同步 schema 校验目标输入是图片输入；离线时只校验存在性
  const imageBindingError = validateImageBindings(source, objectInfo);
  if (imageBindingError) throw new Error(imageBindingError);
  const outputError = validateImageOutput(source);
  if (outputError) throw new Error(outputError);
  return source;
}

/**
 * 解析本次的 LoRA 写入方案
 * 按节点分组的回放快照各写各的节点；旧式扁平快照全部写入首个 LoRA 节点；
 * 其余情况按节点绑定解析（激活组 / 固定组 / 不注入）
 * @param workflow 工作流副本
 * @param settings ComfyUI 设置
 * @param override 显式 LoRA 覆写
 * @returns 写入方案
 */
function resolveLoraPlan(
  workflow: ComfyUIWorkflow,
  settings: Pick<ComfyUISettings, 'loraPresets'>,
  override?: ComfyUILoraPreset | readonly ComfyUILoraSnapshot[] | ComfyUILoraOverride,
): ComfyUILoraPlan {  if (isTaggedLoraOverride(override) && override.kind === 'nodes') {
    return { assignments: toNodeAssignments(workflow, override.nodes), presetName: LORA_PLAYBACK_PRESET_NAME };
  }
  if (isTaggedLoraOverride(override) && override.kind === 'flat') {
    return toFlatLoraPlan(workflow, override.loras);
  }
  if (isFlatLoraOverride(override)) return toFlatLoraPlan(workflow, override);
  const activePreset = resolveEffectiveLoraPreset(settings, override);
  const assignments = resolveComfyUILoraNodeAssignments(workflow, settings.loraPresets, activePreset);
  return { assignments, presetName: summarizeLoraPresetNames(assignments) };
}

/**
 * 旧式扁平快照：全部写入首个 LoRA 节点（空列表也写入，用于按旧语义清空该节点）
 * @param workflow 工作流副本
 * @param loras 扁平 LoRA 快照列表
 * @returns 写入方案
 */
function toFlatLoraPlan(workflow: ComfyUIWorkflow, loras: readonly ComfyUILoraSnapshot[]): ComfyUILoraPlan {
  const firstNodeId = listLoraNodeIds(workflow)[0];
  if (!firstNodeId) return { assignments: [], presetName: LORA_NOT_INJECTED_NAME };
  return {
    assignments: [{ nodeId: firstNodeId, preset: createComfyUILoraPresetFromSnapshots(loras) }],
    presetName: LORA_PLAYBACK_PRESET_NAME,
  };
}

/**
 * 按节点分组的回放快照：各写各的节点，来源节点已不存在的分组丢弃
 * @param workflow 工作流副本
 * @param nodes 按节点分组的 LoRA 快照
 * @returns 节点与生效组的对应列表
 */
function toNodeAssignments(
  workflow: ComfyUIWorkflow,
  nodes: readonly ComfyUILoraNodeSnapshot[],
): ComfyUILoraNodeAssignment[] {
  const validNodeIds = new Set(listLoraNodeIds(workflow));
  return nodes
    .filter(node => validNodeIds.has(node.nodeId))
    .map(node => ({ nodeId: node.nodeId, preset: createComfyUILoraPresetFromSnapshots(node.loras) }));
}

/**
 * 将解析出的 LoRA 组写入工作流副本
 * @param workflow 工作流副本
 * @param plan 写入方案
 */
function applyLoraPlan(workflow: ComfyUIWorkflow, plan: ComfyUILoraPlan): void {
  for (const { nodeId, preset } of plan.assignments) {
    const node = workflow[nodeId];
    if (node) writeLoraPresetToNode(node, preset);
  }
}

/**
 * 汇总本次生效的 LoRA 组名（去重，多组以「 / 」连接）
 * @param assignments 节点与生效组的对应列表
 * @returns 组名字符串；未注入任何组时为「未注入」
 */
function summarizeLoraPresetNames(assignments: readonly ComfyUILoraNodeAssignment[]): string {
  const names: string[] = [];
  for (const { preset } of assignments) {
    const name = preset.name?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names.length ? names.join(' / ') : LORA_NOT_INJECTED_NAME;
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
    throw new Error('正面提示词或负面提示词至少填写一个');
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
 * @param positivePrompt 正面提示词
 * @param negativePrompt 负面提示词
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
