import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { extension_settings } from '@sillytavern/scripts/extensions';

vi.mock('@/services/novelai/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/novelai/api')>()),
  generateNovelAIImagesFromResolvedRequest: vi.fn(),
}));
vi.mock('@/services/comfyui/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/comfyui/api')>()),
  generateComfyUIImagesFromResolvedRequest: vi.fn(),
}));
vi.mock('@/services/comfyui/lora-trigger-words', () => ({ resolveActiveComfyUILoraTriggerWords: vi.fn() }));

import { generateImage } from '@/api/generate-image';
import type { GenerateImageOptions } from '@/api/types';
import type { ImageOrientation } from '@/constants/image-composition';
import { generateComfyUIImagesFromResolvedRequest } from '@/services/comfyui/api';
import { clearComfyUIObjectInfoCache } from '@/services/comfyui/object-info';
import { resolveActiveComfyUILoraTriggerWords } from '@/services/comfyui/lora-trigger-words';
import { generateNovelAIImagesFromResolvedRequest } from '@/services/novelai/api';
import { useSettingsStore } from '@/store/settings';

const novelaiGeneration = vi.mocked(generateNovelAIImagesFromResolvedRequest);
const comfyuiGeneration = vi.mocked(generateComfyUIImagesFromResolvedRequest);
const triggerWords = vi.mocked(resolveActiveComfyUILoraTriggerWords);
const extensionSettings = extension_settings as Record<string, unknown>;
const ORIENTATIONS: ImageOrientation[] = ['portrait', 'landscape', 'square'];

function setupSavedSettings(source: 'novelai' | 'comfyui') {
  const store = useSettingsStore();
  store.savedSettings.imageSource = source;
  store.savedSettings.promptLlm.autoComposition.enabled = true;
  store.savedSettings.novelai.width = 768;
  store.savedSettings.novelai.height = 1280;
  store.savedSettings.comfyui.workflowPresets = {
    activePresetId: 'api-composition',
    presets: [
      {
        id: 'api-composition',
        name: 'API composition',
        favoriteNodeIds: [],
        workflowJson: JSON.stringify({
          '5': { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1280 } },
          '6': {
            class_type: 'CLIPTextEncode',
            inputs: { text: '' },
            _meta: { cosmosVision: { promptBindings: { text: 'positive' }, imageOutput: true } },
          },
        }),
      },
    ],
  };
  return store;
}

function submittedSize(source: 'novelai' | 'comfyui') {
  if (source === 'novelai') {
    const request = novelaiGeneration.mock.calls.at(-1)![0];
    return { width: request.snapshot.width, height: request.snapshot.height };
  }
  return comfyuiGeneration.mock.calls.at(-1)![1].snapshot.resolution;
}

describe.each(['novelai', 'comfyui'] as const)('generateImage auto composition (%s)', source => {
  beforeEach(() => {
    Object.keys(extensionSettings).forEach(key => delete extensionSettings[key]);
    setActivePinia(createPinia());
    clearComfyUIObjectInfoCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline in unit test'))),
    );
    triggerWords.mockResolvedValue([]);
    novelaiGeneration.mockImplementation(async request => ({
      imageBlobs: [new Blob(['image'])],
      snapshot: request.snapshot,
      prompts: request.prompts,
    }));
    comfyuiGeneration.mockResolvedValue([new Blob(['image'])]);
  });

  afterEach(() => {
    clearComfyUIObjectInfoCache();
    vi.unstubAllGlobals();
  });

  it.each(ORIENTATIONS)('extracts %s from rawText into the actual image request', async orientation => {
    const store = setupSavedSettings(source);
    const originalSettings = JSON.stringify(store.savedSettings);
    const result = await generateImage({
      rawText: `<output>${JSON.stringify({ positivePrompt: 'cat', negativePrompt: 'blurry', orientation })}</output>`,
    });

    expect(result.prompts).toMatchObject({ positivePrompt: 'cat', negativePrompt: 'blurry', orientation });
    expect(submittedSize(source)).toEqual(store.savedSettings.promptLlm.autoComposition.sizes[orientation]);
    expect(JSON.stringify(store.savedSettings)).toBe(originalSettings);
    if (source === 'comfyui') {
      expect(comfyuiGeneration.mock.calls.at(-1)![1].workflow['5'].inputs).toMatchObject(submittedSize(source)!);
    }
  });

  it.each(ORIENTATIONS)('uses structured %s input without changing saved settings or prompts', async orientation => {
    const store = setupSavedSettings(source);
    const originalSettings = JSON.stringify(store.savedSettings);
    const input = { positivePrompt: 'cat', orientation };
    const result = await generateImage({ prompts: input });

    expect(result.prompts.orientation).toBe(orientation);
    expect(submittedSize(source)).toEqual(store.savedSettings.promptLlm.autoComposition.sizes[orientation]);
    expect(input).toEqual({ positivePrompt: 'cat', orientation });
    expect(JSON.stringify(store.savedSettings)).toBe(originalSettings);
  });

  it('uses the same final output for prompts and orientation, ignoring earlier and reasoning outputs', async () => {
    setupSavedSettings(source);
    const result = await generateImage({
      rawText: [
        '<think><output>{"positivePrompt":"reasoning portrait","negativePrompt":"old","orientation":"portrait"}</output></think>',
        '<output>{"positivePrompt":"earlier square","negativePrompt":"old","orientation":"square"}</output>',
        '<output>{"positivePrompt":"final wide scene","negativePrompt":"blurry","orientation":"landscape"}</output>',
      ].join('\n'),
    });

    expect(result.prompts).toMatchObject({
      positivePrompt: 'final wide scene',
      negativePrompt: 'blurry',
      orientation: 'landscape',
    });
    expect(submittedSize(source)).toEqual({ width: 1216, height: 832 });
  });

  it('ignores a trailing reasoning output when reading prompts and orientation', async () => {
    setupSavedSettings(source);
    const result = await generateImage({
      rawText: [
        '<output>{"positivePrompt":"final wide scene","negativePrompt":"blurry","orientation":"landscape"}</output>',
        '<think><output>{"positivePrompt":"reasoning portrait","negativePrompt":"old","orientation":"portrait"}</output></think>',
      ].join('\n'),
    });

    expect(result.prompts).toMatchObject({
      positivePrompt: 'final wide scene',
      negativePrompt: 'blurry',
      orientation: 'landscape',
    });
    expect(submittedSize(source)).toEqual({ width: 1216, height: 832 });
  });

  it('keeps the baseline size when auto composition is disabled', async () => {
    const store = setupSavedSettings(source);
    store.savedSettings.promptLlm.autoComposition.enabled = false;

    await generateImage({ prompts: { positivePrompt: 'cat', orientation: 'landscape' } });

    expect(submittedSize(source)).toEqual({ width: 768, height: 1280 });
  });

  it('keeps the baseline size when orientation is missing from rawText', async () => {
    setupSavedSettings(source);
    const result = await generateImage({
      rawText: '<output>{"positivePrompt":"cat","negativePrompt":"blurry"}</output>',
    });

    expect(result.prompts.orientation).toBeUndefined();
    expect(submittedSize(source)).toEqual({ width: 768, height: 1280 });
  });

  it('ignores invalid structured directions and invalid preset sizes', async () => {
    const store = setupSavedSettings(source);
    const invalidInput = {
      prompts: { positivePrompt: 'cat', orientation: 'diagonal' },
    } as unknown as GenerateImageOptions;
    const result = await generateImage(invalidInput);

    expect(result.prompts.orientation).toBeUndefined();
    expect(submittedSize(source)).toEqual({ width: 768, height: 1280 });

    store.savedSettings.promptLlm.autoComposition.sizes.portrait = { width: 833, height: 1216 };
    await generateImage({ prompts: { positivePrompt: 'cat', orientation: 'portrait' } });
    expect(submittedSize(source)).toEqual({ width: 768, height: 1280 });
  });

  it('does not carry a previous request orientation into a later request', async () => {
    setupSavedSettings(source);
    await generateImage({ prompts: { positivePrompt: 'cat', orientation: 'landscape' } });
    expect(submittedSize(source)).toEqual({ width: 1216, height: 832 });

    await generateImage({ prompts: { positivePrompt: 'dog' } });
    expect(submittedSize(source)).toEqual({ width: 768, height: 1280 });
  });

  it('respects each backend size limit when a preset exceeds the NovelAI maximum', async () => {
    const store = setupSavedSettings(source);
    store.savedSettings.promptLlm.autoComposition.sizes.landscape = { width: 3072, height: 1536 };
    await generateImage({ prompts: { positivePrompt: 'wide scene', orientation: 'landscape' } });

    expect(submittedSize(source)).toEqual(
      source === 'novelai' ? { width: 768, height: 1280 } : { width: 3072, height: 1536 },
    );
  });
});

describe('ComfyUI API composition isolation', () => {
  beforeEach(() => {
    Object.keys(extensionSettings).forEach(key => delete extensionSettings[key]);
    setActivePinia(createPinia());
    clearComfyUIObjectInfoCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline in unit test'))),
    );
    triggerWords.mockResolvedValue([]);
    comfyuiGeneration.mockResolvedValue([new Blob(['image'])]);
  });

  afterEach(() => {
    clearComfyUIObjectInfoCache();
    vi.unstubAllGlobals();
  });

  it('keeps the workflow selected before asynchronous trigger word resolution', async () => {
    const store = setupSavedSettings('comfyui');
    let finishTriggers!: (words: string[]) => void;
    triggerWords.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishTriggers = resolve;
        }),
    );
    const pending = generateImage({ prompts: { positivePrompt: 'cat', orientation: 'landscape' } });
    const newPreset = {
      ...store.savedSettings.comfyui.workflowPresets.presets[0],
      id: 'new-workflow',
      workflowJson: JSON.stringify({
        '15': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024 } },
        '16': {
          class_type: 'CLIPTextEncode',
          inputs: { text: '' },
          _meta: { cosmosVision: { promptBindings: { text: 'positive' }, imageOutput: true } },
        },
      }),
    };
    store.savedSettings.comfyui.workflowPresets.presets.push(newPreset);
    store.savedSettings.comfyui.workflowPresets.activePresetId = newPreset.id;
    finishTriggers([]);
    await pending;

    const request = comfyuiGeneration.mock.calls.at(-1)![1];
    expect(request.workflow['5'].inputs).toMatchObject({ width: 1216, height: 832 });
    expect(request.workflow['15']).toBeUndefined();
    expect(request.snapshot.imageOutputNodeId).toBe('6');
    expect(store.savedSettings.comfyui.workflowPresets.activePresetId).toBe('new-workflow');
  });
});
