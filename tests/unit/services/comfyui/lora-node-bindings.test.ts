import { describe, expect, it } from 'vitest';
import type { ComfyUILoraPreset, ComfyUILoraPresetSettings } from '@/constants/comfyui';
import { readNodeMeta, readLoraNodeBinding, writeLoraNodeBinding } from '@/services/comfyui/meta';
import {
  listEffectiveComfyUILoraPresets,
  listLoraNodeIds,
  resolveComfyUILoraNodeAssignments,
  resolveLoraPanelUpdateAction,
} from '@/services/comfyui/lora-node-bindings';
import { isLoraPanelManagedInput } from '@/services/comfyui/lora-adapter';
import type { ComfyUIWorkflow } from '@/services/comfyui/types';

/**
 * 构造双采工作流：两个 LoRA 加载器节点（#56 / #71）夹一个非 LoRA 节点
 * @returns 工作流对象
 */
function createDualSamplerWorkflow(): ComfyUIWorkflow {
  return {
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } },
    '56': { class_type: 'Lora Loader (LoraManager)', inputs: { text: '', loras: { __value__: [] } } },
    '71': {
      class_type: 'Lora Loader (LoraManager)',
      inputs: { text: '<lora:embedded:0.5>', loras: { __value__: [] } },
    },
  };
}

/**
 * 构造 LoRA 组
 * @param id 组 ID
 * @param name 组名
 * @param loraName 组内 LoRA 名
 * @returns LoRA 预设组
 */
function createPreset(id: string, name: string, loraName: string): ComfyUILoraPreset {
  return { id, name, loras: [{ id: `${id}-l1`, name: loraName, strength: 1, enabled: true }] };
}

const ACTIVE_PRESET = createPreset('p-active', '角色A', 'a.safetensors');
const FIXED_PRESET = createPreset('p-fixed', '细节增强', 'b.safetensors');
const LORA_SETTINGS: ComfyUILoraPresetSettings = {
  activePresetId: ACTIVE_PRESET.id,
  presets: [ACTIVE_PRESET, FIXED_PRESET],
};

describe('comfyui lora-node-bindings', () => {
  it('lists every lora node in workflow key order', () => {
    expect(listLoraNodeIds(createDualSamplerWorkflow())).toEqual(['56', '71']);
  });

  it('keeps legacy behaviour when no node is bound', () => {
    const assignments = resolveComfyUILoraNodeAssignments(createDualSamplerWorkflow(), LORA_SETTINGS, ACTIVE_PRESET);

    expect(assignments).toEqual([{ nodeId: '56', preset: ACTIVE_PRESET }]);
  });

  it('applies a different preset to a node bound with fixed mode', () => {
    const workflow = createDualSamplerWorkflow();
    writeLoraNodeBinding(workflow['71']!, { mode: 'fixed', presetId: FIXED_PRESET.id });

    const assignments = resolveComfyUILoraNodeAssignments(workflow, LORA_SETTINGS, ACTIVE_PRESET);

    expect(assignments.map(item => [item.nodeId, item.preset.id])).toEqual([
      ['56', ACTIVE_PRESET.id],
      ['71', FIXED_PRESET.id],
    ]);
  });

  it('treats a node without bindings as following the active preset in read order', () => {
    // 节点 ID 为整数串，Object.entries 按键值升序：#56 才是「首个兼容节点」
    const workflow: ComfyUIWorkflow = {
      '71': { class_type: 'Lora Loader (LoraManager)', inputs: { text: '', loras: { __value__: [] } } },
      '56': { class_type: 'Lora Loader (LoraManager)', inputs: { text: '', loras: { __value__: [] } } },
    };

    const assignments = resolveComfyUILoraNodeAssignments(workflow, LORA_SETTINGS, ACTIVE_PRESET);

    expect(assignments).toEqual([{ nodeId: '56', preset: ACTIVE_PRESET }]);
  });

  it('degrades a dangling fixed binding to the unbound rule instead of another group', () => {
    const workflow = createDualSamplerWorkflow();
    writeLoraNodeBinding(workflow['56']!, { mode: 'fixed', presetId: 'p-deleted' });
    writeLoraNodeBinding(workflow['71']!, { mode: 'fixed', presetId: 'p-deleted' });

    const assignments = resolveComfyUILoraNodeAssignments(workflow, LORA_SETTINGS, ACTIVE_PRESET);

    // 首个节点回落到激活组，非首个节点不再注入，而不是静默改用别的组
    expect(assignments).toEqual([{ nodeId: '56', preset: ACTIVE_PRESET }]);
  });

  it('skips nodes bound to off', () => {
    const workflow = createDualSamplerWorkflow();
    writeLoraNodeBinding(workflow['56']!, { mode: 'off' });
    writeLoraNodeBinding(workflow['71']!, { mode: 'fixed', presetId: FIXED_PRESET.id });

    const assignments = resolveComfyUILoraNodeAssignments(workflow, LORA_SETTINGS, ACTIVE_PRESET);

    expect(assignments).toEqual([{ nodeId: '71', preset: FIXED_PRESET }]);
  });

  it('lets a non-first node follow the active preset through explicit active mode', () => {
    const workflow = createDualSamplerWorkflow();
    writeLoraNodeBinding(workflow['71']!, { mode: 'active' });

    const assignments = resolveComfyUILoraNodeAssignments(workflow, LORA_SETTINGS, ACTIVE_PRESET);

    expect(assignments.map(item => item.nodeId)).toEqual(['56', '71']);
    expect(assignments.every(item => item.preset.id === ACTIVE_PRESET.id)).toBe(true);
  });

  it('lists effective presets deduplicated for trigger words', () => {
    const workflow = createDualSamplerWorkflow();
    writeLoraNodeBinding(workflow['71']!, { mode: 'fixed', presetId: FIXED_PRESET.id });

    const presets = listEffectiveComfyUILoraPresets(JSON.stringify(workflow), LORA_SETTINGS, ACTIVE_PRESET);

    expect(presets.map(preset => preset.id)).toEqual([ACTIVE_PRESET.id, FIXED_PRESET.id]);
  });

  it('omits off nodes from effective presets', () => {
    const workflow = createDualSamplerWorkflow();
    writeLoraNodeBinding(workflow['56']!, { mode: 'off' });

    const presets = listEffectiveComfyUILoraPresets(JSON.stringify(workflow), LORA_SETTINGS, ACTIVE_PRESET);

    expect(presets).toEqual([]);
  });

  it('falls back to the active preset when workflow json cannot be parsed', () => {
    expect(listEffectiveComfyUILoraPresets('not-json', LORA_SETTINGS, ACTIVE_PRESET)).toEqual([ACTIVE_PRESET]);
  });

  it('writes and clears the node binding', () => {
    const workflow = createDualSamplerWorkflow();
    const node = workflow['71']!;

    expect(readLoraNodeBinding(node)).toBeNull();
    writeLoraNodeBinding(node, { mode: 'fixed', presetId: FIXED_PRESET.id });
    expect(readLoraNodeBinding(node)).toEqual({ mode: 'fixed', presetId: FIXED_PRESET.id });
    writeLoraNodeBinding(node, null);
    expect(readLoraNodeBinding(node)).toBeNull();
  });

  it('keeps other node meta untouched when writing the binding', () => {
    const workflow = createDualSamplerWorkflow();
    const node = workflow['71']!;
    node._meta = { cosmosVision: { promptBindings: { text: 'positive' } } };

    writeLoraNodeBinding(node, { mode: 'off' });

    expect(readNodeMeta(node)).toEqual({ promptBindings: { text: 'positive' }, loraBinding: { mode: 'off' } });
  });

  it('classifies panel updates into content, switch and removed', () => {
    const presets = [ACTIVE_PRESET, FIXED_PRESET];
    const content = { activePresetId: ACTIVE_PRESET.id, presets };
    const switched = { activePresetId: FIXED_PRESET.id, presets };
    const removed = { activePresetId: FIXED_PRESET.id, presets: [FIXED_PRESET] };

    expect(resolveLoraPanelUpdateAction(content, ACTIVE_PRESET.id)).toBe('content');
    expect(resolveLoraPanelUpdateAction(switched, ACTIVE_PRESET.id)).toBe('switch');
    expect(resolveLoraPanelUpdateAction(removed, ACTIVE_PRESET.id)).toBe('removed');
  });

  it('exposes the raw loras/text controls only for nodes bound to off', () => {
    const workflow = createDualSamplerWorkflow();
    const node = workflow['71']!;

    expect(isLoraPanelManagedInput(node, 'loras')).toBe(true);
    writeLoraNodeBinding(node, { mode: 'off' });
    // 「不注入」的节点由工作流自身承载 LoRA，需让用户看到并编辑真实值
    expect(isLoraPanelManagedInput(node, 'loras')).toBe(false);
    expect(isLoraPanelManagedInput(node, 'text')).toBe(false);
    expect(isLoraPanelManagedInput(node, 'strength')).toBe(false);
  });
});
