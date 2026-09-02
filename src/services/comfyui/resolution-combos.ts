import type { ComfyUIResolutionCombo } from '@/constants/comfyui';
import { isLinkRef } from '@/services/comfyui/link';
import type { ComfyUILinkRef, ComfyUIWorkflow, ComfyUIWorkflowNode } from '@/services/comfyui/types';


/** 分辨率组合收藏上限 */
export const MAX_RESOLUTION_COMBOS = 12;

/**
 * 按名称排序分辨率组合（zh-CN 区域感知，名称相同按尺寸稳定排序）
 * @param combos 组合列表
 * @returns 排序后的新数组
 */
export function sortResolutionCombos(combos: readonly ComfyUIResolutionCombo[]): ComfyUIResolutionCombo[] {
  return [...combos].sort((left, right) => {
    const byName = left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
    if (byName !== 0) return byName;
    return left.width - right.width || left.height - right.height;
  });
}

/**
 * 创建分辨率组合 ID
 * @returns 唯一 ID
 */
export function createResolutionComboId(): string {
  return `combo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 追加收藏组合：超上限抛错；同尺寸同名去重
 * @param combos 现有组合列表
 * @param combo 新组合
 * @returns 追加后的新列表
 */
export function addResolutionCombo(
  combos: readonly ComfyUIResolutionCombo[],
  combo: ComfyUIResolutionCombo,
): ComfyUIResolutionCombo[] {
  if (combos.length >= MAX_RESOLUTION_COMBOS) {
    throw new Error(`最多收藏 ${MAX_RESOLUTION_COMBOS} 组分辨率，请先删除部分组合`);
  }
  const duplicated = combos.some(
    item => item.width === combo.width && item.height === combo.height && item.name === combo.name,
  );
  if (duplicated) return [...combos];
  return [...combos, combo];
}

/**
 * 更新指定组合（重命名）
 * @param combos 现有组合列表
 * @param id 目标组合 ID
 * @param patch 覆写字段
 * @returns 更新后的新列表
 */
export function updateResolutionCombo(
  combos: readonly ComfyUIResolutionCombo[],
  id: string,
  patch: Partial<Pick<ComfyUIResolutionCombo, 'name' | 'width' | 'height'>>,
): ComfyUIResolutionCombo[] {
  return combos.map(combo => (combo.id === id ? { ...combo, ...patch } : combo));
}

/**
 * 删除指定组合
 * @param combos 现有组合列表
 * @param id 目标组合 ID
 * @returns 删除后的新列表
 */
export function removeResolutionCombo(combos: readonly ComfyUIResolutionCombo[], id: string): ComfyUIResolutionCombo[] {
  return combos.filter(combo => combo.id !== id);
}

/**
 * 读取节点上承载尺寸的可写数字输入
 * Primitive 类节点用 value 承载实际值：优先取 value，否则取唯一的数字输入
 * @param node 节点
 * @returns 输入名与当前值；无唯一数字输入时返回 null
 */
function readSizeCarrierInput(node: ComfyUIWorkflowNode): { inputName: string; value: number } | null {
  const numericEntries = Object.entries(node.inputs ?? {}).filter(
    ([, value]) => typeof value === 'number',
  );
  const preferred = numericEntries.find(([name]) => name === 'value');
  const picked = preferred ?? (numericEntries.length === 1 ? numericEntries[0] : undefined);
  if (!picked) return null;
  return { inputName: picked[0], value: picked[1] as number };
}

/**
 * 沿连线追踪尺寸来源节点
 * @param workflow 工作流
 * @param ref 连线引用
 * @returns 来源节点的尺寸承载输入；无法解析时返回 null
 */
function traceSizeCarrier(
  workflow: ComfyUIWorkflow,
  ref: ComfyUILinkRef,
): { nodeId: string; inputName: string; value: number } | null {
  const source = workflow[String(ref[0])];
  if (!source) return null;
  const carrier = readSizeCarrierInput(source);
  if (!carrier) return null;
  return { nodeId: String(ref[0]), ...carrier };
}

/**
 * 读取节点当前的 width/height 输入值（仅直连数字场景）
 * @param workflow 工作流
 * @param nodeId 节点 ID
 * @returns 尺寸；节点无任一可写 width/height 输入时返回 null
 */
export function readNodeResolution(
  workflow: ComfyUIWorkflow,
  nodeId: string,
): { width: number; height: number } | null {
  const node = workflow[nodeId];
  if (!node) return null;
  const width = node.inputs.width;
  const height = node.inputs.height;
  if (typeof width !== 'number' || typeof height !== 'number') return null;
  return { width, height };
}

/** 分辨率写入点（节点 ID + 输入名） */
export interface ResolutionWritePoint {
  nodeId: string;
  inputName: string;
}

/** 可应用分辨率组合的目标 */
export interface ResolutionTarget {
  /** 去重键：宽高两个写入点的组合 */
  key: string;
  /** 尺寸所属节点 ID（定位展示用） */
  nodeId: string;
  /** 节点显示名（_meta.title 优先，回退 class_type） */
  title: string;
  classType: string;
  /** 宽写入点：直接 width 输入或上游 Primitive 的 value */
  widthPoint: ResolutionWritePoint;
  /** 高写入点 */
  heightPoint: ResolutionWritePoint;
  width: number;
  height: number;
  /** 写入路径展示（如 "width · height" 或 "#17 value · #18 value"） */
  detail: string;
}

/**
 * 扫描工作流中所有可写入分辨率的节点
 * 兼容两种结构：
 * 1. 直连：节点 width/height 均为数字（如 EmptyLatentImage）
 * 2. 连线：width/height 均为连线引用，追到上游 Primitive 节点（单 value 输入）
 * @param workflow 工作流
 * @returns 目标列表（按节点 ID 数值序，按写入点去重）
 */
export function listResolutionTargets(workflow: ComfyUIWorkflow): ResolutionTarget[] {
  const targets: ResolutionTarget[] = [];
  const seen = new Set<string>();
  for (const [nodeId, node] of Object.entries(workflow)) {
    const width = node.inputs?.width;
    const height = node.inputs?.height;
    if (width === undefined || height === undefined) continue;

    let widthPoint: ResolutionWritePoint;
    let heightPoint: ResolutionWritePoint;
    let currentWidth: number;
    let currentHeight: number;
    let detail: string;

    if (typeof width === 'number' && typeof height === 'number') {
      widthPoint = { nodeId, inputName: 'width' };
      heightPoint = { nodeId, inputName: 'height' };
      currentWidth = width;
      currentHeight = height;
      detail = 'width · height';
    } else if (isLinkRef(width) && isLinkRef(height)) {
      const widthCarrier = traceSizeCarrier(workflow, width);
      const heightCarrier = traceSizeCarrier(workflow, height);
      if (!widthCarrier || !heightCarrier) continue;
      widthPoint = { nodeId: widthCarrier.nodeId, inputName: widthCarrier.inputName };
      heightPoint = { nodeId: heightCarrier.nodeId, inputName: heightCarrier.inputName };
      currentWidth = widthCarrier.value;
      currentHeight = heightCarrier.value;
      detail = `#${widthCarrier.nodeId} ${widthCarrier.inputName} · #${heightCarrier.nodeId} ${heightCarrier.inputName}`;
    } else {
      // 一边直连一边连线：结构异常，跳过
      continue;
    }

    const key = `${widthPoint.nodeId}:${widthPoint.inputName}|${heightPoint.nodeId}:${heightPoint.inputName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      key,
      nodeId,
      title: node._meta?.title?.trim() || node.class_type,
      classType: node.class_type,
      widthPoint,
      heightPoint,
      width: currentWidth,
      height: currentHeight,
      detail,
    });
  }
  return targets.sort((left, right) => left.nodeId.localeCompare(right.nodeId, 'en', { numeric: true }));
}

/**
 * 将组合写入目标指向的输入（就地修改，由调用方克隆提交）
 * @param workflow 工作流
 * @param target 应用目标
 * @param combo 分辨率组合
 * @returns 是否成功写入（写入点存在且当前值为数字）
 */
export function applyResolutionToTarget(
  workflow: ComfyUIWorkflow,
  target: ResolutionTarget,
  combo: Pick<ComfyUIResolutionCombo, 'width' | 'height'>,
): boolean {
  const widthNode = workflow[target.widthPoint.nodeId];
  const heightNode = workflow[target.heightPoint.nodeId];
  if (!widthNode || !heightNode) return false;
  if (typeof widthNode.inputs[target.widthPoint.inputName] !== 'number') return false;
  if (typeof heightNode.inputs[target.heightPoint.inputName] !== 'number') return false;
  widthNode.inputs[target.widthPoint.inputName] = combo.width;
  heightNode.inputs[target.heightPoint.inputName] = combo.height;
  return true;
}
