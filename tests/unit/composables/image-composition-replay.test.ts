import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive } from 'vue';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import type { ImageCompositionSnapshot } from '@/constants/image-composition';
import type { CosmosVisionSettings, NovelAISettings } from '@/constants/novelai';
import { createEditedPromptSnapshot } from '@/composables/inlineEditablePromptSnapshot';
import { generateImagesFromSnapshot } from '@/composables/inlineImageGenerationRequests';
import { cloneInlinePromptSnapshot, type InlinePromptSnapshot } from '@/composables/inlineImageLightbox';
import { generateComfyUIImagesFromPrompts, type ComfyUIPromptsGenerationResult } from '@/services/comfyui/api';
import type { ComfyUIRequestSnapshot } from '@/services/comfyui/types';
import { generateNovelAIImageFromPrompts } from '@/services/novelai/api';
import type { NovelAIImageResult } from '@/services/novelai/types';

vi.mock('@/services/comfyui/api', () => ({ generateComfyUIImagesFromPrompts: vi.fn() }));
vi.mock('@/services/comfyui/lora-trigger-words', () => ({
  resolveComfyUILoraTriggerWords: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/novelai/api', () => ({ generateNovelAIImageFromPrompts: vi.fn() }));

const composition: ImageCompositionSnapshot = {
  orientation: 'landscape',
  width: 1216,
  height: 832,
  targetKey: '12:width|12:height',
};

function testSettings(): CosmosVisionSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.novelai.width = 832;
  settings.novelai.height = 1216;
  settings.promptLlm.autoComposition.enabled = false;
  return settings;
}

function comfyRequestSnapshot(): ComfyUIRequestSnapshot {
  return {
    endpoint: 'http://127.0.0.1:8188',
    positivePrompt: 'wide scene',
    negativePrompt: 'blurry',
    imageOutputNodeId: '9',
    promptBindings: [],
    seedValues: [],
    imageBindings: [],
    loras: [],
    resolution: { width: composition.width, height: composition.height },
  };
}

function comfyResult(applied: boolean): ComfyUIPromptsGenerationResult {
  const snapshot = comfyRequestSnapshot();
  return {
    imageBlobs: [new Blob(['comfyui image'])],
    requestSnapshot: snapshot,
    resolvedRequest: {
      workflow: {},
      snapshot,
      imageOutputNodeId: '9',
      resolutionOverrideApplied: applied,
      ...(applied ? { resolutionOverrideTargetKey: composition.targetKey } : {}),
    },
  };
}

function novelaiResult(settings: NovelAISettings): NovelAIImageResult {
  return {
    imageBlob: new Blob(['novelai image']),
    prompts: { positivePrompt: 'wide scene', negativePrompt: 'blurry' },
    snapshot: {
      endpoint: 'https://image.novelai.net',
      accountName: 'Replay account',
      positivePrompt: 'wide scene',
      negativePrompt: 'blurry',
      characterPrompts: [],
      model: settings.model,
      width: settings.width,
      height: settings.height,
      sampler: settings.sampler,
      seed: 123,
      steps: settings.steps,
      guidance: settings.guidance,
      autoSampler: settings.autoSampler,
      varietyPlus: settings.varietyPlus,
      smea: settings.smea,
      smeaDyn: settings.smeaDyn,
      decrisp: settings.decrisp,
      legacyPromptMode: settings.legacyPromptMode,
      promptGuidanceRescale: settings.promptGuidanceRescale,
      noiseSchedule: settings.noiseSchedule,
      ucPreset: settings.ucPreset,
      qualityPreset: settings.qualityPreset,
      imageCount: 1,
      vibes: { count: 0, referenceStrengths: [], informationExtracted: [], resolved: true },
    },
  };
}

function savedSnapshot(imageSource: 'novelai' | 'comfyui'): InlinePromptSnapshot {
  return {
    imageSource,
    ...(imageSource === 'novelai'
      ? {
          positivePrompt: 'wide scene',
          negativePrompt: 'blurry',
          novelai: { positivePrompt: 'wide scene', negativePrompt: 'blurry' },
        }
      : { comfyui: comfyRequestSnapshot() }),
    composition: { ...composition, ...(imageSource === 'novelai' ? { targetKey: undefined } : {}) },
  };
}

beforeEach(() => {
  vi.mocked(generateComfyUIImagesFromPrompts).mockReset();
  vi.mocked(generateNovelAIImageFromPrompts).mockReset();
});

describe('automatic composition snapshot replay', () => {
  it.each([true, false])(
    'replays NovelAI dimensions from the saved image with the feature enabled=%s',
    async enabled => {
      const settings = testSettings();
      settings.promptLlm.autoComposition.enabled = enabled;
      const originalSettings = structuredClone(settings);
      const snapshot = savedSnapshot('novelai');
      const signal = new AbortController().signal;
      vi.mocked(generateNovelAIImageFromPrompts).mockImplementation(async imageSettings =>
        novelaiResult(imageSettings),
      );

      const result = await generateImagesFromSnapshot(settings, snapshot, signal);

      expect(generateNovelAIImageFromPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ width: 1216, height: 832 }),
        snapshot.novelai,
        expect.objectContaining({ signal }),
      );
      expect(result.promptSnapshot.composition).toEqual(snapshot.composition);
      expect(result.promptSnapshot.composition).not.toBe(snapshot.composition);
      expect(result.promptSnapshot.novelaiRequest).toMatchObject({ width: 1216, height: 832 });
      expect(result.imageBlobs).toHaveLength(1);
      expect(settings).toEqual(originalSettings);
    },
  );

  it('falls back to current NovelAI dimensions when an old composition snapshot has invalid dimensions', async () => {
    const settings = testSettings();
    const snapshot = savedSnapshot('novelai');
    snapshot.composition!.width = 777;
    vi.mocked(generateNovelAIImageFromPrompts).mockImplementation(async imageSettings => novelaiResult(imageSettings));

    const result = await generateImagesFromSnapshot(settings, snapshot, new AbortController().signal);

    expect(vi.mocked(generateNovelAIImageFromPrompts).mock.calls[0]?.[0]).toBe(settings.novelai);
    expect(result.promptSnapshot.composition).toBeUndefined();
    expect(result.promptSnapshot.novelaiRequest).toMatchObject({ width: 832, height: 1216 });
  });

  it('replays ComfyUI dimensions and the saved target key even after automatic composition is disabled', async () => {
    const settings = testSettings();
    const snapshot = savedSnapshot('comfyui');
    const signal = new AbortController().signal;
    vi.mocked(generateComfyUIImagesFromPrompts).mockResolvedValueOnce(comfyResult(true));

    const result = await generateImagesFromSnapshot(settings, snapshot, signal);

    expect(generateComfyUIImagesFromPrompts).toHaveBeenCalledWith(
      settings.comfyui,
      { positivePrompt: 'wide scene', negativePrompt: 'blurry' },
      expect.objectContaining({ signal, resolutionOverride: composition }),
    );
    expect(result.promptSnapshot.composition).toEqual(composition);
    expect(result.promptSnapshot.composition).not.toBe(snapshot.composition);
  });

  it('omits composition from a successful ComfyUI result when the dimensions were not applied', async () => {
    const snapshot = savedSnapshot('comfyui');
    const before = structuredClone(snapshot);
    const response = comfyResult(false);
    response.requestSnapshot.resolution = { width: 832, height: 1216 };
    vi.mocked(generateComfyUIImagesFromPrompts).mockResolvedValueOnce(response);

    const result = await generateImagesFromSnapshot(testSettings(), snapshot, new AbortController().signal);

    expect(result.promptSnapshot).not.toHaveProperty('composition');
    expect(result.promptSnapshot.comfyui?.resolution).toEqual({ width: 832, height: 1216 });
    expect(snapshot).toEqual(before);
  });

  it.each(['novelai', 'comfyui'] as const)(
    'does not publish a replacement composition snapshot when %s generation fails',
    async imageSource => {
      const snapshot = savedSnapshot(imageSource);
      const before = structuredClone(snapshot);
      const failure = new Error('generation failed');
      vi.mocked(generateNovelAIImageFromPrompts).mockRejectedValueOnce(failure);
      vi.mocked(generateComfyUIImagesFromPrompts).mockRejectedValueOnce(failure);
      const saveReplacementSnapshot = vi.fn();
      const operation = generateImagesFromSnapshot(testSettings(), snapshot, new AbortController().signal).then(
        result => saveReplacementSnapshot(result.promptSnapshot),
      );

      await expect(operation).rejects.toBe(failure);
      expect(saveReplacementSnapshot).not.toHaveBeenCalled();
      expect(snapshot).toEqual(before);
    },
  );
});

describe('composition snapshot cloning and editing', () => {
  it('copies a reactive composition into an independent plain snapshot that can be persisted', () => {
    const snapshot = reactive(savedSnapshot('comfyui'));
    const cloned = cloneInlinePromptSnapshot(snapshot);

    expect(cloned.composition).toEqual(composition);
    expect(cloned.composition).not.toBe(snapshot.composition);
    expect(isProxy(cloned.composition)).toBe(false);
    expect(() => structuredClone(cloned)).not.toThrow();
    cloned.composition!.width = 640;
    cloned.composition!.targetKey = '5:width|5:height';
    expect(snapshot.composition).toEqual(composition);
  });

  it.each(['novelai', 'comfyui'] as const)(
    'keeps composition while editing the %s prompt and isolates it from the original image',
    imageSource => {
      const snapshot = savedSnapshot(imageSource);
      const originalComposition = { ...snapshot.composition! };
      const edited = createEditedPromptSnapshot(testSettings(), snapshot, {
        positive: 'new wide scene',
        negative: 'new negative',
        characters: [],
        positivePresetId: '',
        negativePresetId: '',
      });

      expect(edited.composition).toEqual(originalComposition);
      expect(edited.composition).not.toBe(snapshot.composition);
      expect(edited.promptParts).toMatchObject({
        positive: { core: 'new wide scene' },
        negative: { core: 'new negative' },
      });
      edited.composition!.height = 640;
      expect(snapshot.composition).toEqual(originalComposition);
    },
  );
});
