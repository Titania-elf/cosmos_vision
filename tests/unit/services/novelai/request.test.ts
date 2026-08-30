import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { buildNovelAIResolvedRequest, buildNovelAIPromptOverrides } from '@/services/novelai/api';

describe('novelai request builder', () => {
  it('builds resolved request with default settings and presets', () => {
    const settings = DEFAULT_SETTINGS.novelai;
    const imagePromptPresets = DEFAULT_SETTINGS.imagePromptPresets;
    const extractSettings = DEFAULT_SETTINGS.promptLlm;

    const resolved = buildNovelAIResolvedRequest(settings, imagePromptPresets, extractSettings, {
      positiveLLMPrompt: 'masterpiece, solo',
      negativeLLMPrompt: 'blurry',
    });

    expect(resolved.snapshot.model).toBe(settings.model);
    expect(resolved.snapshot.positivePrompt).toContain('masterpiece');
    expect(resolved.snapshot.negativePrompt).toContain('blurry');
    expect(resolved.seed).toBeGreaterThanOrEqual(0);
  });

  it('builds prompt overrides from extracted output', () => {
    const overrides = buildNovelAIPromptOverrides(
      { positivePrompt: 'scenery, sunset', negativePrompt: 'low quality' },
      [],
    );
    expect(overrides.positiveLLMPrompt).toBe('scenery, sunset');
    expect(overrides.negativeLLMPrompt).toBe('low quality');
  });

  it('prepends the picked artist tag in front of the whole positive prompt', () => {
    const overrides = { positiveLLMPrompt: 'masterpiece, solo', negativeLLMPrompt: 'blurry' };
    const baseline = buildNovelAIResolvedRequest(
      DEFAULT_SETTINGS.novelai,
      DEFAULT_SETTINGS.imagePromptPresets,
      DEFAULT_SETTINGS.promptLlm,
      overrides,
    );

    const resolved = buildNovelAIResolvedRequest(
      DEFAULT_SETTINGS.novelai,
      DEFAULT_SETTINGS.imagePromptPresets,
      DEFAULT_SETTINGS.promptLlm,
      overrides,
      { enabled: true, entries: [{ id: 'a', name: '厚涂', text: 'artist:wlop', enabled: true }] },
    );

    // 画师串在最前面，其余部分（含质量标签）与不带池时逐字一致
    expect(resolved.snapshot.positivePrompt).toBe(`artist:wlop, ${baseline.snapshot.positivePrompt}`);
    expect(resolved.snapshot.negativePrompt).toBe(baseline.snapshot.negativePrompt);
  });

  it('leaves prompts untouched when the artist pool is off or empty', () => {
    const overrides = { positiveLLMPrompt: 'masterpiece, solo', negativeLLMPrompt: 'blurry' };
    const baseline = buildNovelAIResolvedRequest(
      DEFAULT_SETTINGS.novelai,
      DEFAULT_SETTINGS.imagePromptPresets,
      DEFAULT_SETTINGS.promptLlm,
      overrides,
    );

    const disabled = buildNovelAIResolvedRequest(
      DEFAULT_SETTINGS.novelai,
      DEFAULT_SETTINGS.imagePromptPresets,
      DEFAULT_SETTINGS.promptLlm,
      overrides,
      { enabled: false, entries: [{ id: 'a', name: '厚涂', text: 'artist:wlop', enabled: true }] },
    );
    const empty = buildNovelAIResolvedRequest(
      DEFAULT_SETTINGS.novelai,
      DEFAULT_SETTINGS.imagePromptPresets,
      DEFAULT_SETTINGS.promptLlm,
      overrides,
      { enabled: true, entries: [] },
    );

    expect(disabled.snapshot.positivePrompt).toBe(baseline.snapshot.positivePrompt);
    expect(empty.snapshot.positivePrompt).toBe(baseline.snapshot.positivePrompt);
  });
});
