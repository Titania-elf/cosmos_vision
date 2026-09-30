import type { ComfyUILoraPreset, ComfyUILoraPresetSettings } from '@/constants/comfyui';
import { isSupportedLoraNode } from '@/services/comfyui/lora-adapter';
import { readLoraNodeBinding } from '@/services/comfyui/meta';
import { parseComfyUIWorkflow } from '@/services/comfyui/parse';
import type { ComfyUIWorkflow, ComfyUIWorkflowNode } from '@/services/comfyui/types';

/** 一个 LoRA 加载器节点最终使用的 LoRA 组 */
export interface ComfyUILoraNodeAssignment {
  nodeId: string;
  preset: ComfyUILoraPreset;
}

/** LoRA 库面板提交的类型 */
export type ComfyUILoraPanelUpdateAction = 'content' | 'switch' | 'removed';

/**
 * 按顺序列出工作流内全部 LoRA 加载器节点 ID
 * @param workflow 工作流
 * @returns 节点 ID 列表（按工作流键顺序）
 */
export function listLoraNodeIds(workflow: ComfyUIWorkflow): string[] {
  return Object.entries(workflow)
    .filter(([, node]) => isSupportedLoraNode(node))
    .map(([nodeId]) => nodeId);
}

/**
 * 解析单个 LoRA 节点实际生效的 LoRA 组
 * 未绑定的首个节点沿用「跟随激活组」的旧行为，其余未绑定节点不注入；
 * 绑定的组已被删除时同样按未绑定规则处理，避免静默改用其它组
 * @param node 工作流节点
 * @param isFirstLoraNode 是否为工作流内首个 LoRA 加载器节点
 * @param loraPresets LoRA 预设组集合
 * @param activePreset 本次生效的激活组
 * @returns 生效的 LoRA 组；该节点不注入时为 null
 */
export function resolveLoraNodePreset(
  node: ComfyUIWorkflowNode,
  isFirstLoraNode: boolean,
  loraPresets: ComfyUILoraPresetSettings,
  activePreset: ComfyUILoraPreset,
): ComfyUILoraPreset | null {
  const binding = readLoraNodeBinding(node);
  if (binding?.mode === 'off') return null;
  if (binding?.mode === 'active') return activePreset;
  if (binding?.mode === 'fixed') {
    const bound = loraPresets.presets.find(preset => preset.id === binding.presetId);
    if (bound) return bound;
  }
  return isFirstLoraNode ? activePreset : null;
}

/**
 * 解析工作流内全部 LoRA 节点各自的生效 LoRA 组
 * @param workflow 工作流
 * @param loraPresets LoRA 预设组集合
 * @param activePreset 本次生效的激活组
 * @returns 节点与生效组的对应列表（不含不注入的节点）
 */
export function resolveComfyUILoraNodeAssignments(
  workflow: ComfyUIWorkflow,
  loraPresets: ComfyUILoraPresetSettings,
  activePreset: ComfyUILoraPreset,
): ComfyUILoraNodeAssignment[] {
  const assignments: ComfyUILoraNodeAssignment[] = [];
  let isFirstLoraNode = true;
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!isSupportedLoraNode(node)) continue;
    const preset = resolveLoraNodePreset(node, isFirstLoraNode, loraPresets, activePreset);
    isFirstLoraNode = false;
    if (preset) assignments.push({ nodeId, preset });
  }
  return assignments;
}

/**
 * 解析本次实际生效的全部 LoRA 组（按生效顺序去重）
 * 供触发词解析使用；工作流解析失败时回退到激活组，避免阻断生图
 * @param workflowJson 工作流 JSON 文本
 * @param loraPresets LoRA 预设组集合
 * @param activePreset 本次生效的激活组
 * @returns 生效的 LoRA 组列表（工作流无 LoRA 节点或全部不注入时为空）
 */
export function listEffectiveComfyUILoraPresets(
  workflowJson: string,
  loraPresets: ComfyUILoraPresetSettings,
  activePreset: ComfyUILoraPreset,
): ComfyUILoraPreset[] {
  let assignments: ComfyUILoraNodeAssignment[];
  try {
    assignments = resolveComfyUILoraNodeAssignments(parseComfyUIWorkflow(workflowJson), loraPresets, activePreset);
  } catch {
    return [activePreset];
  }
  const seen = new Set<string>();
  const presets: ComfyUILoraPreset[] = [];
  for (const { preset } of assignments) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
  }
  return presets;
}

/**
 * 识别 LoRA 库面板本次提交的类型
 * 面板当前显示的组从提交结果里消失即为「删除分组」，需清除该节点绑定而不是改绑到兜底组
 * @param next 面板提交的预设组集合
 * @param viewPresetId 面板当前显示的组 ID（该节点实际生效的组）
 * @returns 提交类型：内容编辑 / 切换分组 / 删除分组
 */
export function resolveLoraPanelUpdateAction(
  next: ComfyUILoraPresetSettings,
  viewPresetId: string,
): ComfyUILoraPanelUpdateAction {
  if (!next.presets.some(preset => preset.id === viewPresetId)) return 'removed';
  return next.activePresetId === viewPresetId ? 'content' : 'switch';
}
