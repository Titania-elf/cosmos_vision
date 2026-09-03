import { describe, expect, it } from 'vitest';
import {
  getActiveComfyUILoraTriggerWords,
  prependLoraTriggerWords,
} from '@/services/comfyui/lora-presets';
import type { ComfyUILoraPresetSettings, ComfyUILoraSetting } from '@/constants/comfyui';

describe('comfyui lora trigger words', () => {
  const loras: ComfyUILoraSetting[] = [
    { id: 'l1', name: 'a.safetensors', strength: 1, enabled: true, triggerWords: ['loraA_v1', 'loraB'] },
    { id: 'l2', name: 'b.safetensors', strength: 1, enabled: true, triggerWords: [' lorab ', '', 'loraC'] },
    { id: 'l3', name: 'c.safetensors', strength: 1, enabled: false, triggerWords: ['disabledWord'] },
  ];

  it('collects trigger words from enabled loras with dedupe', () => {
    const settings = createSettings(loras);
    expect(getActiveComfyUILoraTriggerWords(settings)).toEqual(['loraA_v1', 'loraB', 'loraC']);
  });

  it('skips disabled loras', () => {
    const settings = createSettings(loras);
    const words = getActiveComfyUILoraTriggerWords(settings);
    expect(words).not.toContain('disabledWord');
  });

  it('prepends trigger words before prompt', () => {
    expect(prependLoraTriggerWords('masterpiece, 1girl', ['triggerA', 'triggerB'])).toBe(
      'triggerA, triggerB, masterpiece, 1girl',
    );
  });

  it('skips trigger words already present in prompt (case-insensitive)', () => {
    expect(prependLoraTriggerWords('TriggerA, 1girl', ['triggerA', 'triggerB'])).toBe('triggerB, TriggerA, 1girl');
  });

  it('returns prompt unchanged when no trigger words or all already present', () => {
    expect(prependLoraTriggerWords('masterpiece', [])).toBe('masterpiece');
    expect(prependLoraTriggerWords('triggerA', ['TriggerA'])).toBe('triggerA');
  });

  it('detects prompt tokens split by comma and newline', () => {
    expect(prependLoraTriggerWords('1girl\ntriggerA, masterpiece', ['triggerA'])).toBe(
      '1girl\ntriggerA, masterpiece',
    );
  });
});

/**
 * 构建 LoRA 预设组集合
 * @param loras LoRA 条目列表
 * @returns 预设组集合
 */
function createSettings(loras: ComfyUILoraSetting[]): ComfyUILoraPresetSettings {
  return { activePresetId: 'p1', presets: [{ id: 'p1', name: 'Preset 1', loras }] };
}
