import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { generateComfyUIImagesFromPrompts } from '@/services/comfyui/api';
import { clearComfyUIObjectInfoCache } from '@/services/comfyui/object-info';
import {
  buildComfyUIResolvedRequest,
  buildComfyUIResolvedRequestFromPrompts,
  type ComfyUIResolutionOverride,
} from '@/services/comfyui/request';
import { listResolutionTargets } from '@/services/comfyui/resolution-combos';
import type { ComfyUIWorkflow } from '@/services/comfyui/types';
import { createMockFetch } from '../../../helpers/fetch-mocks';

const PROMPTS = { positivePrompt: 'a portrait', negativePrompt: 'low quality' };
const PORTRAIT: ComfyUIResolutionOverride = { width: 832, height: 1216 };

function createSettings(nodes: ComfyUIWorkflow = {}) {
  const settings = structuredClone(DEFAULT_SETTINGS.comfyui);
  const workflow: ComfyUIWorkflow = {
    ...nodes,
    '6': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'original prompt' },
      _meta: { cosmosVision: { promptBindings: { text: 'positive' } } },
    },
    '9': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'CV' },
      _meta: { cosmosVision: { imageOutput: true } },
    },
  };
  settings.workflowPresets = {
    activePresetId: 'composition',
    presets: [{ id: 'composition', name: 'Composition', workflowJson: JSON.stringify(workflow), favoriteNodeIds: [] }],
  };
  return settings;
}

function createLatent(width = 1024, height = 1024) {
  return { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } };
}

describe('ComfyUI request composition resolution', () => {
  beforeEach(() => {
    clearComfyUIObjectInfoCache();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline in unit test'))),
    );
  });

  afterEach(() => {
    clearComfyUIObjectInfoCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('applies an override to the sole target and leaves settings and later requests untouched', async () => {
    const settings = createSettings({ '5': createLatent() });
    const original = structuredClone(settings);
    const overridden = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, PORTRAIT);

    expect(overridden.workflow['5'].inputs).toEqual({ width: 832, height: 1216, batch_size: 1 });
    expect(overridden.snapshot.resolution).toEqual(PORTRAIT);
    expect(overridden.resolutionOverrideApplied).toBe(true);
    expect(overridden.resolutionOverrideTargetKey).toBe('5:width|5:height');
    expect(settings).toEqual(original);

    const unmodified = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS);
    expect(unmodified.workflow['5'].inputs).toEqual({ width: 1024, height: 1024, batch_size: 1 });
    expect(unmodified.snapshot.resolution).toEqual({ width: 1024, height: 1024 });
    expect(unmodified.resolutionOverrideApplied).toBe(false);
    expect(unmodified.resolutionOverrideTargetKey).toBeUndefined();
    expect(settings).toEqual(original);
  });

  it('passes the seventh argument through the shared prompt preset builder', async () => {
    const settings = createSettings({ '5': createLatent() });
    const resolved = await buildComfyUIResolvedRequest(
      settings,
      DEFAULT_SETTINGS.imagePromptPresets,
      PROMPTS,
      [],
      undefined,
      undefined,
      PORTRAIT,
    );

    expect(resolved.workflow['5'].inputs.width).toBe(832);
    expect(resolved.snapshot.resolution).toEqual(PORTRAIT);
    expect(resolved.resolutionOverrideApplied).toBe(true);
  });

  it('updates only the explicit target and snapshots its resolution instead of the first target', async () => {
    const settings = createSettings({ '5': createLatent(512, 512), '12': createLatent() });
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, {
      ...PORTRAIT,
      targetKey: '12:width|12:height',
    });

    expect(resolved.workflow['5'].inputs).toMatchObject({ width: 512, height: 512 });
    expect(resolved.workflow['12'].inputs).toMatchObject(PORTRAIT);
    expect(resolved.snapshot.resolution).toEqual(PORTRAIT);
    expect(resolved.resolutionOverrideApplied).toBe(true);
    expect(resolved.resolutionOverrideTargetKey).toBe('12:width|12:height');
  });

  it('keeps ambiguous targets unchanged even when the first target already matches the override', async () => {
    const settings = createSettings({ '5': createLatent(832, 1216), '12': createLatent() });
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, PORTRAIT);

    expect(resolved.workflow['5'].inputs).toMatchObject(PORTRAIT);
    expect(resolved.workflow['12'].inputs).toMatchObject({ width: 1024, height: 1024 });
    expect(resolved.snapshot.resolution).toEqual(PORTRAIT);
    expect(resolved.resolutionOverrideApplied).toBe(false);
    expect(resolved.resolutionOverrideTargetKey).toBeUndefined();
  });

  it.each(['missing:width|missing:height', ''])('requires an exact explicit target match (%j)', async targetKey => {
    const settings = createSettings({ '5': createLatent() });
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, {
      ...PORTRAIT,
      targetKey,
    });

    expect(resolved.workflow['5'].inputs).toMatchObject({ width: 1024, height: 1024 });
    expect(resolved.snapshot.resolution).toEqual({ width: 1024, height: 1024 });
    expect(resolved.resolutionOverrideApplied).toBe(false);
  });

  it('keeps workflows without a writable resolution target unchanged', async () => {
    const settings = createSettings();
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, PORTRAIT);

    expect(resolved.snapshot.resolution).toBeUndefined();
    expect(resolved.resolutionOverrideApplied).toBe(false);
    expect(Object.keys(resolved.workflow)).toEqual(['6', '9']);
  });

  it.each([0, -64, 32, 4097, 4160, 832.5, 833, Number.NaN, Number.POSITIVE_INFINITY])(
    'ignores invalid width or height %j without a partial write',
    async invalid => {
      const settings = createSettings({ '5': createLatent() });
      for (const override of [
        { width: invalid, height: 1216 },
        { width: 832, height: invalid },
      ]) {
        const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, override);
        expect(resolved.workflow['5'].inputs).toMatchObject({ width: 1024, height: 1024 });
        expect(resolved.resolutionOverrideApplied).toBe(false);
      }
    },
  );

  it('accepts the inclusive supported size bounds', async () => {
    const settings = createSettings({ '5': createLatent() });
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, {
      width: 64,
      height: 4096,
    });

    expect(resolved.snapshot.resolution).toEqual({ width: 64, height: 4096 });
    expect(resolved.resolutionOverrideApplied).toBe(true);
  });

  it('writes linked Primitive values once while preserving consumer links and source workflow', async () => {
    const settings = createSettings({
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['18', 0] } },
      '12': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['18', 0] } },
      '17': { class_type: 'PrimitiveInt', inputs: { value: 1024 } },
      '18': { class_type: 'PrimitiveInt', inputs: { value: 1024 } },
    });
    const originalJson = settings.workflowPresets.presets[0].workflowJson;
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, PORTRAIT);

    expect(resolved.workflow['17'].inputs.value).toBe(832);
    expect(resolved.workflow['18'].inputs.value).toBe(1216);
    expect(resolved.workflow['5'].inputs).toEqual({ width: ['17', 0], height: ['18', 0] });
    expect(resolved.workflow['12'].inputs).toEqual({ width: ['17', 0], height: ['18', 0] });
    expect(listResolutionTargets(resolved.workflow)).toHaveLength(1);
    expect(resolved.snapshot.resolution).toEqual(PORTRAIT);
    expect(resolved.resolutionOverrideApplied).toBe(true);
    expect(resolved.resolutionOverrideTargetKey).toBe('17:value|18:value');
    expect(settings.workflowPresets.presets[0].workflowJson).toBe(originalJson);
    expect(JSON.parse(originalJson)['17'].inputs.value).toBe(1024);
  });

  it('does not claim a non-square override was applied when width and height share one carrier', async () => {
    const settings = createSettings({
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['17', 0] } },
      '17': { class_type: 'PrimitiveInt', inputs: { value: 1024 } },
    });
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, PORTRAIT);

    expect(resolved.workflow['17'].inputs.value).toBe(1024);
    expect(resolved.snapshot.resolution).toEqual({ width: 1024, height: 1024 });
    expect(resolved.resolutionOverrideApplied).toBe(false);
  });

  it('reports no applied composition when a later runtime binding supersedes the carrier size', async () => {
    const settings = createSettings({
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['18', 0] } },
      '17': {
        class_type: 'PrimitiveInt',
        inputs: { value: 1024 },
        _meta: { cosmosVision: { seedModes: { value: 'randomize' } } },
      },
      '18': { class_type: 'PrimitiveInt', inputs: { value: 1024 } },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const resolved = await buildComfyUIResolvedRequestFromPrompts(settings, PROMPTS, [], undefined, PORTRAIT);

    expect(resolved.workflow['17'].inputs.value).toBe(0);
    expect(resolved.snapshot.resolution).toEqual({ width: 0, height: 1216 });
    expect(resolved.snapshot.seedValues).toEqual([{ nodeId: '17', inputName: 'value', mode: 'randomize', value: 0 }]);
    expect(resolved.resolutionOverrideApplied).toBe(false);
    expect(resolved.resolutionOverrideTargetKey).toBeUndefined();
  });

  it('passes replay resolution options into the workflow submitted by the prompts API', async () => {
    const settings = createSettings({ '5': createLatent(512, 512), '12': createLatent() });
    const original = structuredClone(settings);
    const imageBlob = new Blob(['generated image'], { type: 'image/png' });
    let queuedWorkflow: ComfyUIWorkflow | undefined;
    vi.stubGlobal(
      'fetch',
      createMockFetch((url, init) => {
        if (url.endsWith('/object_info')) throw new Error('offline object info');
        if (url.endsWith('/prompt')) {
          queuedWorkflow = JSON.parse(String(init?.body)).prompt as ComfyUIWorkflow;
          return { json: { prompt_id: 'replay' } };
        }
        if (url.endsWith('/history/replay')) {
          return { json: { replay: { outputs: { '9': { images: [{ filename: 'replay.png' }] } } } } };
        }
        if (url.includes('/view?')) return { blob: imageBlob };
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const result = await generateComfyUIImagesFromPrompts(settings, PROMPTS, {
      loraTriggerWords: [],
      resolutionOverride: { ...PORTRAIT, targetKey: '12:width|12:height' },
    });

    expect(queuedWorkflow?.['5'].inputs).toMatchObject({ width: 512, height: 512 });
    expect(queuedWorkflow?.['12'].inputs).toMatchObject(PORTRAIT);
    expect(result.requestSnapshot.resolution).toEqual(PORTRAIT);
    expect(result.resolvedRequest.resolutionOverrideApplied).toBe(true);
    expect(result.resolvedRequest.resolutionOverrideTargetKey).toBe('12:width|12:height');
    expect(result.imageBlobs).toEqual([imageBlob]);
    expect(settings).toEqual(original);
  });
});
