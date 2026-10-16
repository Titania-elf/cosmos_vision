import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { DEFAULT_IMAGE_COMPOSITION_SETTINGS, type ImageCompositionSettings } from '@/constants/image-composition';
import {
  imageCompositionSettingsSchema,
  promptLlmSettingsSchema,
  recoverImageCompositionSettings,
  recoverPromptLlmSettings,
} from '@/store/prompt-llm-settings';
import { useSettingsStore } from '@/store/settings';

const extensionSettings = extension_settings as Record<string, unknown>;

describe('image composition settings schema and recovery', () => {
  it('defaults old prompt LLM settings to disabled composition', () => {
    const legacy = { ...DEFAULT_SETTINGS.promptLlm, autoComposition: undefined };
    expect(promptLlmSettingsSchema.parse(legacy).autoComposition).toEqual(DEFAULT_IMAGE_COMPOSITION_SETTINGS);
    expect(recoverPromptLlmSettings({ historyFloorCount: 7 }).autoComposition).toEqual(
      DEFAULT_IMAGE_COMPOSITION_SETTINGS,
    );
    expect(recoverImageCompositionSettings(undefined)).toEqual(DEFAULT_IMAGE_COMPOSITION_SETTINGS);
  });

  it('fills missing nested sizes without overwriting configured fields', () => {
    const partial = { enabled: true, sizes: { portrait: { width: 768 } }, prompt: '自定义构图规则' };
    const expected = {
      ...DEFAULT_IMAGE_COMPOSITION_SETTINGS,
      enabled: true,
      sizes: { ...DEFAULT_IMAGE_COMPOSITION_SETTINGS.sizes, portrait: { width: 768, height: 1216 } },
      prompt: '自定义构图规则',
    };
    expect(imageCompositionSettingsSchema.parse(partial)).toEqual(expected);
    expect(recoverImageCompositionSettings(partial)).toEqual(expected);
    expect(imageCompositionSettingsSchema.parse({})).toEqual(DEFAULT_IMAGE_COMPOSITION_SETTINGS);
  });

  it('creates independent nested defaults for each schema parse and recovery', () => {
    const parsed = imageCompositionSettingsSchema.parse({});
    parsed.sizes.portrait.width = 640;
    parsed.comfyuiTargets.workflow = '5:width|5:height';
    const recovered = recoverImageCompositionSettings(undefined);
    recovered.sizes.square.width = 512;
    expect(imageCompositionSettingsSchema.parse({})).toEqual(DEFAULT_IMAGE_COMPOSITION_SETTINGS);
    expect(DEFAULT_IMAGE_COMPOSITION_SETTINGS.sizes.portrait.width).toBe(832);
    expect(DEFAULT_IMAGE_COMPOSITION_SETTINGS.sizes.square.width).toBe(1024);
    expect(DEFAULT_IMAGE_COMPOSITION_SETTINGS.comfyuiTargets).toEqual({});
  });

  it.each([0, 63, 4097, 4160, 800, 832.5, Number.NaN, '832', null])(
    'recovers an invalid width (%s) without losing other valid dimensions or options',
    width => {
      const partial = {
        enabled: true,
        sizeMode: 'swap',
        sizes: {
          portrait: { width, height: 1536 },
          landscape: { width: 1536, height: 768 },
          square: { width: 1280, height: 1280 },
        },
        prompt: '保持人物完整入镜',
        comfyuiTargets: { workflow: '17:value|18:value' },
      };
      expect(imageCompositionSettingsSchema.safeParse(partial).success).toBe(false);
      expect(recoverImageCompositionSettings(partial)).toEqual({
        ...partial,
        sizes: { ...partial.sizes, portrait: { width: 832, height: 1536 } },
      });
    },
  );

  it('recovers invalid switches, mode, prompt and target entries independently', () => {
    const recovered = recoverImageCompositionSettings({
      enabled: 'yes',
      sizeMode: 'invalid',
      sizes: { landscape: { width: 1920, height: 1088 }, square: { width: 'bad', height: 1280 } },
      prompt: 42,
      comfyuiTargets: { valid: '5:width|5:height', invalid: 12, missing: null, automatic: '' },
    });
    expect(recovered).toEqual({
      ...DEFAULT_IMAGE_COMPOSITION_SETTINGS,
      sizes: {
        portrait: { width: 832, height: 1216 },
        landscape: { width: 1920, height: 1088 },
        square: { width: 1024, height: 1280 },
      },
      comfyuiTargets: { valid: '5:width|5:height', automatic: '' },
    });
  });

  it('accepts both inclusive dimension bounds', () => {
    const composition = {
      ...DEFAULT_IMAGE_COMPOSITION_SETTINGS,
      sizes: {
        portrait: { width: 64, height: 4096 },
        landscape: { width: 4096, height: 64 },
        square: { width: 4096, height: 4096 },
      },
    };
    expect(imageCompositionSettingsSchema.parse(composition)).toEqual(composition);
  });
});

describe('image composition settings persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.keys(extensionSettings).forEach(key => delete extensionSettings[key]);
  });

  it.each(['presets', 'swap'] as const)('saves and reloads all composition fields in %s mode', sizeMode => {
    const composition: ImageCompositionSettings = {
      enabled: true,
      sizeMode,
      sizes: {
        portrait: { width: 768, height: 1536 },
        landscape: { width: 1920, height: 1088 },
        square: { width: 1280, height: 1280 },
      },
      prompt: '按焦点场景决定构图。\n用户指定方向时优先遵从。',
      comfyuiTargets: { 'workflow-a': '5:width|5:height', 'workflow-b': '17:value|18:value' },
    };
    const store = useSettingsStore();
    store.settings.promptLlm.autoComposition = composition;
    expect(store.isDirty).toBe(true);
    store.applySettings();
    expect(store.savedSettings.promptLlm.autoComposition).toEqual(composition);
    expect(store.isDirty).toBe(false);

    extensionSettings.cosmos_vision = JSON.parse(JSON.stringify(extensionSettings.cosmos_vision));
    setActivePinia(createPinia());
    const reloaded = useSettingsStore();
    expect(reloaded.savedSettings.promptLlm.autoComposition).toEqual(composition);
    expect(reloaded.settings.promptLlm.autoComposition).toEqual(composition);
    expect(reloaded.isDirty).toBe(false);

    reloaded.settings.promptLlm.autoComposition.enabled = false;
    delete reloaded.settings.promptLlm.autoComposition.comfyuiTargets['workflow-a'];
    reloaded.applySettings();
    setActivePinia(createPinia());
    const disabled = useSettingsStore().savedSettings.promptLlm.autoComposition;
    expect(disabled.enabled).toBe(false);
    expect(disabled.comfyuiTargets).toEqual({ 'workflow-b': '17:value|18:value' });
    expect(disabled.sizes).toEqual(composition.sizes);
    expect(disabled.prompt).toBe(composition.prompt);
  });
});
