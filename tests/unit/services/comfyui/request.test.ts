import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { buildComfyUIResolvedRequest } from '@/services/comfyui/request';

describe('comfyui request builder', () => {
  it('builds resolved request with workflow and prompt replacements', () => {
    const settings = structuredClone(DEFAULT_SETTINGS.comfyui);
    settings.workflowPresets.presets = [
      {
        id: 'preset-1',
        name: 'SDXL Workflow',
        workflowJson: JSON.stringify({
          '6': {
            class_type: 'CLIPTextEncode',
            inputs: { text: 'positive placeholder' },
            _meta: { cosmosVision: { promptBindings: { text: 'positive' }, imageOutput: true } },
          },
        }),
        favoriteNodeIds: [],
      },
    ];
    settings.workflowPresets.activePresetId = 'preset-1';

    const imagePromptPresets = DEFAULT_SETTINGS.imagePromptPresets;

    const resolved = buildComfyUIResolvedRequest(settings, imagePromptPresets, {
      positivePrompt: 'masterpiece, 1girl',
      negativePrompt: 'low quality',
    });

    expect(resolved.snapshot.positivePrompt).toContain('masterpiece, 1girl');
    expect(resolved.imageOutputNodeId).toBe('6');
    expect(resolved.workflow['6'].inputs.text).toContain('masterpiece, 1girl');
  });

  it('throws error when active preset is missing', () => {
    const settings = structuredClone(DEFAULT_SETTINGS.comfyui);
    settings.workflowPresets.presets = [];
    settings.workflowPresets.activePresetId = 'non-existent';

    expect(() =>
      buildComfyUIResolvedRequest(settings, DEFAULT_SETTINGS.imagePromptPresets, {
        positivePrompt: '',
        negativePrompt: '',
      }),
    ).toThrow();
  });

  it('prepends the picked artist tag into the positive prompt and its node binding', () => {
    const settings = createPromptBindingSettings();
    const prompts = { positivePrompt: 'masterpiece, 1girl', negativePrompt: 'low quality' };

    const resolved = buildComfyUIResolvedRequest(settings, DEFAULT_SETTINGS.imagePromptPresets, prompts, {
      enabled: true,
      entries: [{ id: 'a', name: '厚涂', text: 'artist:wlop', enabled: true }],
    });

    expect(resolved.snapshot.positivePrompt.startsWith('artist:wlop, ')).toBe(true);
    expect(resolved.snapshot.positivePrompt).toContain('masterpiece, 1girl');
    expect(resolved.workflow['6'].inputs.text).toBe(resolved.snapshot.positivePrompt);
    expect(resolved.snapshot.negativePrompt).not.toContain('artist:wlop');
  });

  it('leaves the positive prompt untouched when the artist pool is off or all entries disabled', () => {
    const prompts = { positivePrompt: 'masterpiece, 1girl', negativePrompt: 'low quality' };
    const baseline = buildComfyUIResolvedRequest(
      createPromptBindingSettings(),
      DEFAULT_SETTINGS.imagePromptPresets,
      prompts,
    );

    const poolOff = buildComfyUIResolvedRequest(createPromptBindingSettings(), DEFAULT_SETTINGS.imagePromptPresets, prompts, {
      enabled: false,
      entries: [{ id: 'a', name: '厚涂', text: 'artist:wlop', enabled: true }],
    });
    const entriesOff = buildComfyUIResolvedRequest(createPromptBindingSettings(), DEFAULT_SETTINGS.imagePromptPresets, prompts, {
      enabled: true,
      entries: [{ id: 'a', name: '厚涂', text: 'artist:wlop', enabled: false }],
    });

    expect(poolOff.snapshot.positivePrompt).toBe(baseline.snapshot.positivePrompt);
    expect(entriesOff.snapshot.positivePrompt).toBe(baseline.snapshot.positivePrompt);
  });

  it('records workflow preset name, lora preset name and resolution into the snapshot', () => {
    const settings = createPromptBindingSettings();
    settings.workflowPresets.presets[0]!.workflowJson = JSON.stringify({
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'positive placeholder' },
        _meta: { cosmosVision: { promptBindings: { text: 'positive' }, imageOutput: true } },
      },
      '27': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    });
    settings.loraPresets.presets = [
      { id: 'lora-1', name: '立绘风格组', loras: [] },
    ];
    settings.loraPresets.activePresetId = 'lora-1';

    const resolved = buildComfyUIResolvedRequest(settings, DEFAULT_SETTINGS.imagePromptPresets, {
      positivePrompt: 'masterpiece, 1girl',
      negativePrompt: 'low quality',
    });

    expect(resolved.snapshot.workflowPresetName).toBe('SDXL Workflow');
    expect(resolved.snapshot.loraPresetName).toBe('立绘风格组');
    expect(resolved.snapshot.resolution).toEqual({ width: 832, height: 1216 });
  });

  it('records undefined resolution when the workflow has no size nodes', () => {
    const resolved = buildComfyUIResolvedRequest(createPromptBindingSettings(), DEFAULT_SETTINGS.imagePromptPresets, {
      positivePrompt: 'masterpiece, 1girl',
      negativePrompt: 'low quality',
    });

    expect(resolved.snapshot.workflowPresetName).toBe('SDXL Workflow');
    expect(resolved.snapshot.resolution).toBeUndefined();
  });
});

/**
 * 构建带正向提示词绑定的 ComfyUI 设置
 * @returns ComfyUI 设置
 */
function createPromptBindingSettings() {
  const settings = structuredClone(DEFAULT_SETTINGS.comfyui);
  settings.workflowPresets.presets = [
    {
      id: 'preset-1',
      name: 'SDXL Workflow',
      workflowJson: JSON.stringify({
        '6': {
          class_type: 'CLIPTextEncode',
          inputs: { text: 'positive placeholder' },
          _meta: { cosmosVision: { promptBindings: { text: 'positive' }, imageOutput: true } },
        },
      }),
      favoriteNodeIds: [],
    },
  ];
  settings.workflowPresets.activePresetId = 'preset-1';
  return settings;
}
