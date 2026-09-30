import { describe, expect, it } from 'vitest';
import {
  isSupportedLoraNode,
  readLoraNodeSnapshots,
  writeLoraPresetToNode,
} from '@/services/comfyui/lora-adapter';
import { applyActiveLoraPresetToWorkflowJson } from '@/services/comfyui/lora-presets';

describe('comfyui lora-adapter', () => {
  const sampleWorkflow = {
    '10': {
      class_type: 'Lora Loader (LoraManager)',
      inputs: {
        text: '<lora:old_lora.safetensors:1.0:1.0>',
        loras: {
          __value__: [
            { name: 'old_lora.safetensors', strength: 1.0, active: true, clipStrength: 1.0, expanded: false },
          ],
        },
      },
    },
  };

  it('checks if node supports lora panel', () => {
    expect(isSupportedLoraNode(sampleWorkflow['10'])).toBe(true);
    expect(isSupportedLoraNode(undefined)).toBe(false);
  });

  it('extracts lora snapshot from workflow object', () => {
    const groups = readLoraNodeSnapshots(sampleWorkflow, ['10']);
    expect(groups).toHaveLength(1);
    expect(groups[0].nodeId).toBe('10');
    expect(groups[0].loras[0].name).toBe('old_lora.safetensors');
    expect(groups[0].loras[0].strength).toBe(1.0);
  });

  it('only reads the requested nodes', () => {
    const dualWorkflow = {
      ...sampleWorkflow,
      '56': {
        class_type: 'Lora Loader (LoraManager)',
        inputs: {
          text: '',
          loras: { __value__: [{ name: 'second.safetensors', strength: 0.5, active: true }] },
        },
      },
    };

    expect(readLoraNodeSnapshots(dualWorkflow, ['56'])).toEqual([
      { nodeId: '56', loras: [{ name: 'second.safetensors', strength: 0.5 }] },
    ]);
    // 不存在或非 LoRA 节点的 ID 直接跳过，不抛错
    expect(readLoraNodeSnapshots(dualWorkflow, ['404', '9'])).toEqual([]);
  });

  it('writes lora preset to workflow node', () => {
    const preset = {
      id: 'p1',
      name: 'Preset 1',
      loras: [
        { id: 'l1', name: 'new_lora_a.safetensors', strength: 0.8, enabled: true as const },
      ],
    };
    const node = structuredClone(sampleWorkflow['10']);
    writeLoraPresetToNode(node, preset);

    expect(node.inputs.text).toContain('<lora:new_lora_a:0.8>');
  });

  it('applies active lora preset to workflow json', () => {
    const workflowJson = JSON.stringify({
      '10': {
        class_type: 'Lora Loader (LoraManager)',
        inputs: { text: '', loras: { __value__: [] } },
      },
    });
    const loraSettings = {
      activePresetId: 'p1',
      presets: [
        {
          id: 'p1',
          name: 'Preset 1',
          loras: [{ id: 'l1', name: 'my_lora.safetensors', strength: 0.7, enabled: true as const }],
        },
      ],
    };
    const result = applyActiveLoraPresetToWorkflowJson(workflowJson, loraSettings);
    expect(result).toContain('<lora:my_lora:0.7>');
    expect(result).toContain('my_lora');
  });

  it('returns original json when no lora node or parse fails', () => {
    const noLoraJson = JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } });
    const loraSettings = { activePresetId: 'p1', presets: [] };
    expect(applyActiveLoraPresetToWorkflowJson(noLoraJson, loraSettings)).toBe(noLoraJson);
    expect(applyActiveLoraPresetToWorkflowJson('not-json', loraSettings)).toBe('not-json');
  });
});
