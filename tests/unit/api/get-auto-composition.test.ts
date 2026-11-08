import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { getAutoComposition } from '@/api/get-auto-composition';
import type { ImageSource } from '@/constants/comfyui';
import type { ComfyUIWorkflow } from '@/services/comfyui/types';
import { useSettingsStore } from '@/store/settings';

const extensionSettings = extension_settings as Record<string, unknown>;
const DEFAULT_SCHEMES = [
  { orientation: 'portrait', label: '竖图', width: 832, height: 1216 },
  { orientation: 'landscape', label: '横图', width: 1216, height: 832 },
  { orientation: 'square', label: '方图', width: 1024, height: 1024 },
];

function createLatent(width = 768, height = 1280) {
  return { class_type: 'EmptyLatentImage', inputs: { width, height } };
}

function setupSavedSettings(imageSource: ImageSource = 'novelai', workflow: ComfyUIWorkflow = { '5': createLatent() }) {
  const store = useSettingsStore();
  store.savedSettings.imageSource = imageSource;
  store.savedSettings.promptLlm.autoComposition.enabled = true;
  store.savedSettings.novelai.width = 768;
  store.savedSettings.novelai.height = 1280;
  store.savedSettings.comfyui.workflowPresets = {
    activePresetId: 'composition-api',
    presets: [
      { id: 'composition-api', name: '构图测试', workflowJson: JSON.stringify(workflow), favoriteNodeIds: [] },
    ],
  };
  return store;
}

describe('api/get-auto-composition', () => {
  beforeEach(() => {
    Object.keys(extensionSettings).forEach(key => delete extensionSettings[key]);
    setActivePinia(createPinia());
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('getter must not request network'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['novelai', 'comfyui'] as const)('returns saved %s schemes without changing settings or requesting network', async imageSource => {
    const store = setupSavedSettings(imageSource);
    const originalSettings = JSON.stringify(store.savedSettings);

    const result = await getAutoComposition();

    expect(result).toMatchObject({ enabled: true, available: true, imageSource, sizeMode: 'presets' });
    expect(result.schemes).toEqual(DEFAULT_SCHEMES);
    expect(result.instruction).toContain(store.savedSettings.promptLlm.autoComposition.prompt);
    expect(result.instruction).toContain('当前可用构图方案：portrait（竖图，832×1216）');
    expect(JSON.stringify(store.savedSettings)).toBe(originalSettings);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['novelai', 'comfyui'] as const)('returns no schemes or instruction when disabled (%s)', async imageSource => {
    const store = setupSavedSettings(imageSource);
    store.savedSettings.promptLlm.autoComposition.enabled = false;

    expect(await getAutoComposition()).toEqual({
      enabled: false,
      available: false,
      imageSource,
      sizeMode: 'presets',
      schemes: [],
      instruction: '',
    });
  });

  it('reads saved settings rather than unapplied panel drafts', async () => {
    const store = setupSavedSettings();
    store.settings.imageSource = 'comfyui';
    store.settings.promptLlm.autoComposition.enabled = false;
    store.settings.promptLlm.autoComposition.sizes.portrait = { width: 512, height: 768 };
    store.settings.promptLlm.autoComposition.prompt = '未应用的规则';

    const result = await getAutoComposition();

    expect(result.imageSource).toBe('novelai');
    expect(result.enabled).toBe(true);
    expect(result.schemes).toEqual(DEFAULT_SCHEMES);
    expect(result.instruction).not.toContain('未应用的规则');
  });

  it('filters invalid orientation dimensions and NovelAI dimensions above its backend limit', async () => {
    const store = setupSavedSettings();
    store.savedSettings.promptLlm.autoComposition.sizes.portrait = { width: 1216, height: 832 };
    store.savedSettings.promptLlm.autoComposition.sizes.landscape = { width: 2560, height: 832 };

    const result = await getAutoComposition();

    expect(result.available).toBe(true);
    expect(result.schemes).toEqual([DEFAULT_SCHEMES[2]]);
    expect(result.instruction).toContain('当前可用构图方案：square（方图，1024×1024）');
    expect(result.instruction).toContain('只能从上述可用方案中选择');
  });

  it('distinguishes enabled from available when no configured sizes can be applied', async () => {
    const store = setupSavedSettings();
    store.savedSettings.promptLlm.autoComposition.sizes = {
      portrait: { width: 1280, height: 768 },
      landscape: { width: 768, height: 1280 },
      square: { width: 768, height: 1280 },
    };

    expect(await getAutoComposition()).toMatchObject({ enabled: true, available: false, schemes: [], instruction: '' });
  });

  it.each(['novelai', 'comfyui'] as const)('uses current source dimensions in swap mode (%s)', async imageSource => {
    const store = setupSavedSettings(imageSource);
    store.savedSettings.promptLlm.autoComposition.sizeMode = 'swap';

    const result = await getAutoComposition();

    expect(result.sizeMode).toBe('swap');
    expect(result.schemes).toEqual([
      { orientation: 'portrait', label: '竖图', width: 768, height: 1280 },
      { orientation: 'landscape', label: '横图', width: 1280, height: 768 },
      { orientation: 'square', label: '方图', width: 960, height: 960 },
    ]);
  });

  it.each(['novelai', 'comfyui'] as const)('only offers square when swap source dimensions are square (%s)', async imageSource => {
    const store = setupSavedSettings(imageSource, { '5': createLatent(1024, 1024) });
    store.savedSettings.promptLlm.autoComposition.sizeMode = 'swap';
    store.savedSettings.novelai.width = 1024;
    store.savedSettings.novelai.height = 1024;

    expect((await getAutoComposition()).schemes).toEqual([DEFAULT_SCHEMES[2]]);
  });

  it('returns independent result objects and reflects later saved configuration changes', async () => {
    const store = setupSavedSettings();
    const result = await getAutoComposition();
    result.schemes[0].width = 64;
    result.schemes[0].orientation = 'square';
    result.schemes.push({ orientation: 'square', label: '外部修改', width: 64, height: 64 });
    result.imageSource = 'comfyui';

    expect((await getAutoComposition()).schemes).toEqual(DEFAULT_SCHEMES);
    expect(store.savedSettings.promptLlm.autoComposition.sizes.portrait).toEqual({ width: 832, height: 1216 });
    expect(store.savedSettings.imageSource).toBe('novelai');
    store.savedSettings.promptLlm.autoComposition.sizes.portrait = { width: 512, height: 768 };
    store.savedSettings.promptLlm.autoComposition.prompt = '用户自定义构图规则';
    const next = await getAutoComposition();
    expect(next.schemes[0]).toMatchObject({ width: 512, height: 768 });
    expect(next.instruction).toContain('用户自定义构图规则');
  });

  it('uses the default instruction when the saved custom prompt is blank', async () => {
    const store = setupSavedSettings();
    store.savedSettings.promptLlm.autoComposition.prompt = '   ';

    expect((await getAutoComposition()).instruction).toContain('根据当前焦点场景');
  });

  it('allows ComfyUI dimensions beyond the NovelAI limit', async () => {
    const store = setupSavedSettings('comfyui');
    store.savedSettings.promptLlm.autoComposition.sizes.landscape = { width: 2560, height: 832 };

    expect((await getAutoComposition()).schemes[1]).toMatchObject({ width: 2560, height: 832 });
  });

  it('does not offer ComfyUI schemes when multiple targets are unselected', async () => {
    setupSavedSettings('comfyui', { '5': createLatent(), '10': createLatent(1024, 1024) });

    expect(await getAutoComposition()).toMatchObject({ enabled: true, available: false, schemes: [], instruction: '' });
  });

  it('uses the explicitly selected ComfyUI target for swap sizes', async () => {
    const store = setupSavedSettings('comfyui', { '5': createLatent(), '10': createLatent(512, 1024) });
    store.savedSettings.promptLlm.autoComposition.sizeMode = 'swap';
    store.savedSettings.promptLlm.autoComposition.comfyuiTargets['composition-api'] = '10:width|10:height';

    expect((await getAutoComposition()).schemes[0]).toEqual({
      orientation: 'portrait', label: '竖图', width: 512, height: 1024,
    });
  });

  it('does not fall back to a sole ComfyUI target when the saved selection is stale', async () => {
    const store = setupSavedSettings('comfyui');
    store.savedSettings.promptLlm.autoComposition.comfyuiTargets['composition-api'] = 'missing';

    expect((await getAutoComposition()).available).toBe(false);
  });

  it('returns unavailable for a ComfyUI workflow with no writable size target', async () => {
    setupSavedSettings('comfyui', { '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } } });

    expect((await getAutoComposition()).schemes).toEqual([]);
  });

  it('returns unavailable for invalid ComfyUI workflow JSON without rejecting', async () => {
    const store = setupSavedSettings('comfyui');
    store.savedSettings.comfyui.workflowPresets.presets[0].workflowJson = 'invalid json';

    expect(await getAutoComposition()).toMatchObject({ available: false, schemes: [], instruction: '' });
  });

  it('only offers square when ComfyUI width and height share one writable input', async () => {
    setupSavedSettings('comfyui', {
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['17', 0] } },
      '17': { class_type: 'PrimitiveInt', inputs: { value: 1024 } },
    });

    expect((await getAutoComposition()).schemes).toEqual([DEFAULT_SCHEMES[2]]);
  });
});
