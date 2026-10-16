import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import type { ComfyUISettings } from '@/constants/comfyui';
import {
  DEFAULT_IMAGE_COMPOSITION_SETTINGS,
  type ImageCompositionSettings,
  type ImageOrientation,
} from '@/constants/image-composition';
import { extractImageOrientation, resolveImageComposition } from '@/services/image-composition';
import { resolveComfyUIImageComposition } from '@/services/comfyui/image-composition';

function compositionSettings(overrides: Partial<ImageCompositionSettings> = {}): ImageCompositionSettings {
  return { ...structuredClone(DEFAULT_IMAGE_COMPOSITION_SETTINGS), enabled: true, ...overrides };
}

describe('extractImageOrientation', () => {
  it('reads the top-level orientation from the final output, ignoring reasoning and earlier outputs', () => {
    const raw = [
      '<think>{"orientation":"portrait"}</think>',
      '<output>{"orientation":"square"}</output>',
      '<output>{"positivePrompt":"two people facing each other","orientation":"landscape"}</output>',
    ].join('\n');

    expect(extractImageOrientation(raw)).toBe('landscape');
  });

  it('accepts fenced final JSON and unwrapped JSON', () => {
    expect(extractImageOrientation('<output>```json\n{"orientation":"portrait"}\n```</output>')).toBe('portrait');
    expect(extractImageOrientation('{"orientation":"square"}')).toBe('square');
  });

  it.each([
    '{}',
    '{"orientation":"diagonal"}',
    '{"orientation":"Landscape"}',
    '{"orientation":null}',
    '{"orientation":["portrait"]}',
    '{"characters":[{"orientation":"landscape"}]}',
    '{"positivePrompt":"orientation: portrait"}',
    '[{"orientation":"portrait"}]',
  ])('ignores missing, nested or invalid orientations in final JSON: %s', output => {
    const raw = `<think>orientation: landscape</think>\n<output>${output}</output>`;

    expect(extractImageOrientation(raw)).toBeUndefined();
  });

  it('does not reuse an earlier orientation when the final output omits it', () => {
    const raw = '<output>{"orientation":"portrait"}</output>\n<output>{"positivePrompt":"cat"}</output>';

    expect(extractImageOrientation(raw)).toBeUndefined();
  });

  it('supports a standalone labeled orientation in legacy final output', () => {
    const raw =
      '<think>orientation: portrait</think>\n<output>positive: two people\norientation: landscape\nnegative: blurry</output>';

    expect(extractImageOrientation(raw)).toBe('landscape');
    expect(extractImageOrientation('positive: centered cat\n"orientation": "square",')).toBe('square');
    expect(extractImageOrientation('positive: cat, orientation: portrait')).toBeUndefined();
  });

  it('does not use a direction that appears only in a reasoning block', () => {
    expect(extractImageOrientation('<think>\norientation: portrait\n</think>')).toBeUndefined();
  });

  it('does not treat malformed nested JSON as legacy labeled output', () => {
    const raw = '<output>{\n"positivePrompt": "cat",\n"characters": [{\n"orientation": "portrait"\n}]\n</output>';

    expect(extractImageOrientation(raw)).toBeUndefined();
  });
});

function comfySettings(twoTargets = false): ComfyUISettings {
  const settings = structuredClone(DEFAULT_SETTINGS.comfyui);
  const workflow = {
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
    ...(twoTargets
      ? { '12': { class_type: 'EmptyLatentImage', inputs: { width: 640, height: 1280, batch_size: 1 } } }
      : {}),
  };
  settings.workflowPresets = {
    activePresetId: 'scene-workflow',
    presets: [
      { id: 'scene-workflow', name: 'Scene workflow', workflowJson: JSON.stringify(workflow), favoriteNodeIds: ['5'] },
    ],
  };
  return settings;
}

describe('resolveComfyUIImageComposition', () => {
  it('selects the only writable size target and records its key for the request', () => {
    const settings = comfySettings();
    const before = structuredClone(settings);
    const resolved = resolveComfyUIImageComposition(settings, compositionSettings(), 'landscape');

    expect(resolved.composition).toEqual({
      orientation: 'landscape',
      width: 1216,
      height: 832,
      targetKey: '5:width|5:height',
    });
    expect(settings).toEqual(before);
  });

  it('uses only the configured target in a workflow with two different size pairs', () => {
    const settings = comfySettings(true);
    const options = compositionSettings({
      sizeMode: 'swap',
      comfyuiTargets: { 'scene-workflow': '12:width|12:height' },
    });
    const resolved = resolveComfyUIImageComposition(settings, options, 'landscape');

    expect(resolved.composition).toEqual({
      orientation: 'landscape',
      width: 1280,
      height: 640,
      targetKey: '12:width|12:height',
    });
    expect(JSON.parse(settings.workflowPresets.presets[0]!.workflowJson)['5'].inputs).toMatchObject({
      width: 832,
      height: 1216,
    });
  });

  it('falls back when multiple targets are ambiguous or a saved target no longer exists', () => {
    const settings = comfySettings(true);

    expect(resolveComfyUIImageComposition(settings, compositionSettings(), 'landscape').composition).toBeUndefined();
    expect(
      resolveComfyUIImageComposition(
        settings,
        compositionSettings({ comfyuiTargets: { 'scene-workflow': 'missing' } }),
        'landscape',
      ).composition,
    ).toBeUndefined();
  });

  it('falls back safely when disabled, missing an orientation, or given an invalid workflow', () => {
    const settings = comfySettings();

    expect(
      resolveComfyUIImageComposition(settings, compositionSettings({ enabled: false }), 'landscape').composition,
    ).toBeUndefined();
    expect(resolveComfyUIImageComposition(settings, compositionSettings(), undefined).composition).toBeUndefined();
    settings.workflowPresets.presets[0]!.workflowJson = 'invalid workflow';
    expect(resolveComfyUIImageComposition(settings, compositionSettings(), 'landscape').composition).toBeUndefined();
  });

  it('captures reactive workflow settings before panel changes without cloning Vue proxies', () => {
    const settings = reactive(comfySettings());
    const originalJson = settings.workflowPresets.presets[0]!.workflowJson;
    const resolved = resolveComfyUIImageComposition(settings, compositionSettings(), 'landscape');
    settings.workflowPresets.activePresetId = 'other-workflow';
    settings.workflowPresets.presets[0]!.workflowJson = '{}';
    settings.workflowPresets.presets[0]!.favoriteNodeIds.push('12');

    expect(resolved.settings.workflowPresets.activePresetId).toBe('scene-workflow');
    expect(resolved.settings.workflowPresets.presets[0]!.workflowJson).toBe(originalJson);
    expect(resolved.settings.workflowPresets.presets[0]!.favoriteNodeIds).toEqual(['5']);
    expect(resolved.composition?.targetKey).toBe('5:width|5:height');
  });
});

describe('resolveImageComposition', () => {
  const currentSize = { width: 768, height: 1280 };

  it.each<ImageOrientation>(['portrait', 'landscape', 'square'])('selects the configured %s preset', orientation => {
    const settings = compositionSettings();

    expect(resolveImageComposition(settings, orientation, currentSize)).toEqual({
      orientation,
      ...settings.sizes[orientation],
    });
  });

  it('preserves the current request size when disabled or the direction is missing', () => {
    expect(resolveImageComposition(undefined, 'portrait', currentSize)).toBeUndefined();
    expect(resolveImageComposition(compositionSettings({ enabled: false }), 'landscape', currentSize)).toBeUndefined();
    expect(resolveImageComposition(compositionSettings(), undefined, currentSize)).toBeUndefined();
  });

  it('swaps the current edges for landscape and portrait without changing pixel area', () => {
    const settings = compositionSettings({ sizeMode: 'swap' });
    const landscape = resolveImageComposition(settings, 'landscape', currentSize);
    const portrait = resolveImageComposition(settings, 'portrait', { width: 1280, height: 768 });

    expect(landscape).toEqual({ orientation: 'landscape', width: 1280, height: 768 });
    expect(portrait).toEqual({ orientation: 'portrait', width: 768, height: 1280 });
    expect(landscape!.width * landscape!.height).toBe(currentSize.width * currentSize.height);
  });

  it('rounds the area-preserving square edge to the closest multiple of 64', () => {
    const square = resolveImageComposition(compositionSettings({ sizeMode: 'swap' }), 'square', currentSize);

    expect(square).toEqual({ orientation: 'square', width: 960, height: 960 });
    expect(Math.abs(square!.width - Math.sqrt(currentSize.width * currentSize.height))).toBeLessThanOrEqual(32);
  });

  it('keeps square sources unchanged when a non-square direction cannot be obtained by swapping', () => {
    const settings = compositionSettings({ sizeMode: 'swap' });

    expect(resolveImageComposition(settings, 'portrait', { width: 1024, height: 1024 })).toBeUndefined();
    expect(resolveImageComposition(settings, 'landscape', { width: 1024, height: 1024 })).toBeUndefined();
    expect(resolveImageComposition(settings, 'square', { width: 1024, height: 1024 })).toEqual({
      orientation: 'square',
      width: 1024,
      height: 1024,
    });
  });

  it.each([
    { width: 0, height: 1216 },
    { width: 833, height: 1216 },
    { width: 832, height: 4160 },
    { width: 1216, height: 832 },
    { width: Number.NaN, height: 1216 },
  ])('falls back when the chosen portrait size is invalid: %j', portrait => {
    const settings = compositionSettings();
    settings.sizes.portrait = portrait;

    expect(resolveImageComposition(settings, 'portrait', currentSize)).toBeUndefined();
  });

  it('rejects invalid swap dimensions and a rectangular square preset', () => {
    expect(
      resolveImageComposition(compositionSettings({ sizeMode: 'swap' }), 'landscape', { width: 777, height: 1280 }),
    ).toBeUndefined();
    const settings = compositionSettings();
    settings.sizes.square = { width: 1024, height: 960 };

    expect(resolveImageComposition(settings, 'square', currentSize)).toBeUndefined();
  });

  it('returns independent per-request snapshots without mutating settings or current dimensions', () => {
    const settings = compositionSettings();
    const settingsBefore = structuredClone(settings);
    const defaultsBefore = structuredClone(DEFAULT_IMAGE_COMPOSITION_SETTINGS);
    const requestSize = { ...currentSize };
    const first = resolveImageComposition(settings, 'landscape', requestSize)!;
    const second = resolveImageComposition(settings, 'portrait', requestSize)!;
    first.width = 64;

    expect(second).toEqual({ orientation: 'portrait', ...settingsBefore.sizes.portrait });
    expect(settings).toEqual(settingsBefore);
    expect(DEFAULT_IMAGE_COMPOSITION_SETTINGS).toEqual(defaultsBefore);
    expect(requestSize).toEqual(currentSize);
  });
});
