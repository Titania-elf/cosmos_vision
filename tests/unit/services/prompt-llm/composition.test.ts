import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_LLM_OUTPUT_FIELDS, DEFAULT_SETTINGS } from '@/constants/default-settings';
import {
  DEFAULT_IMAGE_COMPOSITION_SETTINGS,
  DEFAULT_PROMPT_LLM_COMPOSITION_MESSAGE_ID,
  PROMPT_LLM_COMPOSITION_TOKEN,
} from '@/constants/image-composition';
import type {
  PromptLlmContext,
  PromptLlmMessage,
  PromptLlmMessagePresetSettings,
  PromptLlmSettings,
} from '@/constants/prompt-llm';
import type { PromptLlmRuntimeContent } from '@/services/prompt-llm/message-preset';
import {
  buildPromptLlmOrderedPrompts,
  buildPromptLlmRuntimeRequestFromContext,
  extractPromptLlmResult,
} from '@/services/prompt-llm/runtime-request';
import { buildJsonSchema } from '@/services/tavern-helper/prompt-llm';

const instructionMarker = 'Choose the framing for this scene.';
const context: PromptLlmContext = {
  historyParagraphs: ['Earlier scene.', 'Two people face each other across a table.'],
  focusParagraph: 'Two people face each other across a table.',
  specialRequest: 'Use a wide shot.',
};

function settingsWithComposition(enabled = true): PromptLlmSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS.promptLlm),
    autoCharacterInfo: false,
    useNpcLibrary: false,
    autoComposition: {
      ...structuredClone(DEFAULT_IMAGE_COMPOSITION_SETTINGS),
      enabled,
      prompt: instructionMarker,
    },
  };
}

function presetWithMessages(messages: PromptLlmMessage[]): PromptLlmMessagePresetSettings {
  return { activePresetId: 'custom', presets: [{ id: 'custom', name: 'Custom preset', messages }] };
}

function runtimeContent(compositionContent?: string): PromptLlmRuntimeContent {
  return {
    historyContent: context.historyParagraphs.join('\n\n'),
    participantContent: '',
    focusParagraphContent: context.focusParagraph,
    specialRequestContent: context.specialRequest,
    compositionContent,
  };
}

describe('composition in Prompt LLM requests', () => {
  it('expands the composition macro once and preserves focus and special requests', async () => {
    const preset = presetWithMessages([
      { id: 'composition', title: 'Composition', role: 'system', content: PROMPT_LLM_COMPOSITION_TOKEN },
      { id: 'focus', title: 'Scene', role: 'user', content: '{{focus_paragraph}}\n{{special_request}}' },
    ]);
    const request = await buildPromptLlmRuntimeRequestFromContext(context, settingsWithComposition(), preset, {
      profiles: [],
    });
    const content = request
      .ordered_prompts!.map(prompt => (typeof prompt === 'string' ? prompt : prompt.content))
      .join('\n');

    expect(content.split(instructionMarker)).toHaveLength(2);
    expect(content).not.toContain(PROMPT_LLM_COMPOSITION_TOKEN);
    expect(content).toContain(context.focusParagraph);
    expect(content).toContain(context.specialRequest);
    expect(request.ordered_prompts).toHaveLength(2);
    expect(request.json_schema?.value.properties).toHaveProperty('orientation', {
      type: 'string',
      enum: ['portrait', 'landscape', 'square'],
      description: expect.any(String),
    });
  });

  it('removes an empty composition message and omits its schema field when disabled', async () => {
    const preset = presetWithMessages([
      { id: 'composition', title: 'Composition', role: 'system', content: PROMPT_LLM_COMPOSITION_TOKEN },
      { id: 'focus', title: 'Scene', role: 'user', content: '{{focus_paragraph}}' },
    ]);
    const request = await buildPromptLlmRuntimeRequestFromContext(context, settingsWithComposition(false), preset, {
      profiles: [],
    });

    expect(request.ordered_prompts).toEqual([{ role: 'user', content: context.focusParagraph }]);
    expect(request.json_schema?.value.properties).not.toHaveProperty('orientation');
    expect(request.json_schema?.value.required).not.toContain('orientation');
  });

  it('includes the built-in composition item once in an enabled default request', async () => {
    const builtin = DEFAULT_SETTINGS.promptLlmMessagePresets.presets.find(
      preset => preset.id === DEFAULT_SETTINGS.promptLlmMessagePresets.activePresetId,
    )!;
    expect(builtin.messages.find(message => message.id === DEFAULT_PROMPT_LLM_COMPOSITION_MESSAGE_ID)?.content).toBe(
      PROMPT_LLM_COMPOSITION_TOKEN,
    );

    const request = await buildPromptLlmRuntimeRequestFromContext(
      context,
      settingsWithComposition(),
      DEFAULT_SETTINGS.promptLlmMessagePresets,
      { profiles: [] },
    );

    expect(
      request.ordered_prompts!.filter(
        prompt => typeof prompt !== 'string' && prompt.content.includes(instructionMarker),
      ),
    ).toHaveLength(1);
  });

  it('appends one system instruction for an older preset without a composition macro', async () => {
    const preset = presetWithMessages([{ id: 'scene', title: 'Scene', role: 'user', content: '{{focus_paragraph}}' }]);
    const content = runtimeContent(instructionMarker);
    const prompts = await buildPromptLlmOrderedPrompts(preset, content);

    expect(prompts).toEqual([
      { role: 'user', content: context.focusParagraph },
      { role: 'system', content: instructionMarker },
    ]);
    expect(preset.presets[0]!.messages).toHaveLength(1);
    expect(content.compositionContent).toBe(instructionMarker);
  });

  it('still appends the instruction when a macro message is excluded by its trigger', async () => {
    const preset = presetWithMessages([
      {
        id: 'conditional-composition',
        title: 'Composition',
        role: 'system',
        content: PROMPT_LLM_COMPOSITION_TOKEN,
        triggerMatchMode: 'any_match',
        triggerKeywordGroups: [['unrelated-keyword']],
      },
      { id: 'scene', title: 'Scene', role: 'user', content: '{{focus_paragraph}}' },
    ]);

    expect(await buildPromptLlmOrderedPrompts(preset, runtimeContent(instructionMarker))).toEqual([
      { role: 'user', content: context.focusParagraph },
      { role: 'system', content: instructionMarker },
    ]);
  });
});

describe('composition JSON schema', () => {
  it('requires the top-level enum only when composition is enabled, preserving character fields', () => {
    const originalFields = structuredClone(DEFAULT_PROMPT_LLM_OUTPUT_FIELDS);
    const plain = buildJsonSchema(DEFAULT_PROMPT_LLM_OUTPUT_FIELDS);
    const withComposition = buildJsonSchema(DEFAULT_PROMPT_LLM_OUTPUT_FIELDS, true);
    const properties = withComposition.value.properties as Record<string, unknown>;

    expect(plain.value.properties).not.toHaveProperty('orientation');
    expect(plain.value.required).not.toContain('orientation');
    expect(properties.orientation).toMatchObject({ type: 'string', enum: ['portrait', 'landscape', 'square'] });
    expect(withComposition.value.required).toContain('orientation');
    expect(properties[DEFAULT_PROMPT_LLM_OUTPUT_FIELDS.characterPrompts!]).toEqual(
      (plain.value.properties as Record<string, unknown>)[DEFAULT_PROMPT_LLM_OUTPUT_FIELDS.characterPrompts!],
    );
    expect(DEFAULT_PROMPT_LLM_OUTPUT_FIELDS).toEqual(originalFields);
  });
});

describe('composition in prompt extraction', () => {
  it('keeps prompts, characters and orientation from the same final output block', () => {
    const earlier = {
      positivePrompt: 'earlier scene',
      negativePrompt: 'earlier negative',
      orientation: 'portrait',
      characterPrompts: [{ positivePrompt: 'earlier character', negativePrompt: '', position: { x: 0.5, y: 0.5 } }],
    };
    const final = {
      positivePrompt: 'wide final scene',
      negativePrompt: 'final negative',
      orientation: 'landscape',
      characterPrompts: [{ positivePrompt: 'final character', negativePrompt: '', position: { x: 0.25, y: 0.5 } }],
    };
    const raw = `<think><output>${JSON.stringify(earlier)}</output></think>\n<output>${JSON.stringify(earlier)}</output>\n<output>${JSON.stringify(final)}</output>`;
    const settings = { ...settingsWithComposition(), preferJsonSchemaExtraction: true };
    const result = extractPromptLlmResult(raw, settings);

    expect(result.output).toEqual({
      positivePrompt: final.positivePrompt,
      negativePrompt: final.negativePrompt,
      orientation: final.orientation,
    });
    expect(result.characterPrompts).toEqual(final.characterPrompts);
  });

  it('carries the valid top-level direction alongside positive, negative and character prompts', () => {
    const raw = `<output>${JSON.stringify({
      positivePrompt: 'two people, wide shot',
      negativePrompt: 'blurry',
      orientation: 'landscape',
      characterPrompts: [{ positivePrompt: 'red hair', negativePrompt: '', position: { x: 0.25, y: 0.5 } }],
    })}</output>`;
    const result = extractPromptLlmResult(raw, settingsWithComposition());

    expect(result.output).toEqual({
      positivePrompt: 'two people, wide shot',
      negativePrompt: 'blurry',
      orientation: 'landscape',
    });
    expect(result.characterPrompts).toHaveLength(1);
    expect(result.characterPrompts[0]?.positivePrompt).toBe('red hair');
  });

  it.each([undefined, 'diagonal', 'Landscape', null, { orientation: 'portrait' }])(
    'extracts usable prompts even when orientation is absent or invalid: %j',
    orientation => {
      const raw = `<output>${JSON.stringify({ positivePrompt: 'cat', negativePrompt: 'blurry', orientation })}</output>`;
      const result = extractPromptLlmResult(raw, settingsWithComposition());

      expect(result.output).toEqual({ positivePrompt: 'cat', negativePrompt: 'blurry' });
    },
  );

  it('does not let a nested character direction change the overall image orientation', () => {
    const raw =
      '<output>{"positivePrompt":"cat","negativePrompt":"blurry","characterPrompts":[{"orientation":"portrait"}]}</output>';

    expect(extractPromptLlmResult(raw, settingsWithComposition()).output).toEqual({
      positivePrompt: 'cat',
      negativePrompt: 'blurry',
    });
  });
});
