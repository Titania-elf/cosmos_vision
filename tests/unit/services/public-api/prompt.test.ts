import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTheaterJsonSchema, buildTheaterMessages, extractTheaterResult } from '@/services/public-api/prompt';
import { normalizePromptLlmMessagePresets } from '@/services/prompt-llm/message-preset';
import { DEFAULT_PROMPT_LLM_PRESET_ID } from '@/constants/default-prompt-llm-preset';
import { EXCERPT, LLM_RESULT, makeRequest, makeSettings, THEATER_TEXT } from './fixtures';

const RETIRED_THEATER_PRESET_ID = 'prompt-llm-theater-preset';

afterEach(() => vi.unstubAllGlobals());

describe('theater prompt and supplied-only context', () => {
  it('drops the retired theater preset and re-points its active selection', () => {
    const initial = {
      activePresetId: RETIRED_THEATER_PRESET_ID,
      presets: [
        { id: RETIRED_THEATER_PRESET_ID, name: '小剧场配图', messages: [] },
        { id: 'ordinary', name: '日常', messages: [] },
      ],
    };
    const migrated = normalizePromptLlmMessagePresets(initial);
    expect(migrated.presets.map(preset => preset.id)).toEqual(['ordinary']);
    expect(migrated.activePresetId).toBe(DEFAULT_PROMPT_LLM_PRESET_ID);
  });

  it('uses the active preset by default without switching the global selection', async () => {
    const settings = makeSettings();
    settings.promptLlmMessagePresets.presets.push({
      id: 'ordinary',
      name: '日常',
      messages: [{ id: 'custom', title: '日常规则', role: 'system', content: '日常预设规则', enabled: true }],
    });
    settings.promptLlmMessagePresets.activePresetId = 'ordinary';
    const messages = await buildTheaterMessages(settings, makeRequest(), settings.novelai.model);
    expect(messages[0]!.content).toContain('日常预设规则');
    expect(settings.promptLlmMessagePresets.activePresetId).toBe('ordinary');
  });

  it('uses a request-specific preset and replaces only the known runtime tokens', async () => {
    const settings = makeSettings();
    const request = makeRequest();
    const active = settings.promptLlmMessagePresets.activePresetId;
    request.presetId = 'custom-theater';
    request.context.participants = '{{char}} remains literal';
    settings.promptLlmMessagePresets.presets.push({
      id: request.presetId,
      name: '自定义小剧场',
      messages: [
        {
          id: 'custom',
          title: '测试',
          role: 'system',
          enabled: true,
          content: '{{// comment }}自定义画风 {{participants}} {{theater_text}}',
        },
      ],
    });
    vi.stubGlobal(
      'TavernHelper',
      new Proxy(
        {},
        {
          get() {
            throw new Error('读取了当前聊天');
          },
        },
      ),
    );
    const messages = await buildTheaterMessages(settings, request, settings.novelai.model);
    expect(messages[0]!.content).toContain('{{char}} remains literal');
    expect(messages[0]!.content).toContain(THEATER_TEXT);
    expect(messages[0]!.content).not.toContain('comment');
    expect(settings.promptLlmMessagePresets.activePresetId).toBe(active);
  });

  it('keeps macro-shaped template text literal and rejects EJS templates', async () => {
    const settings = makeSettings();
    const preset = settings.promptLlmMessagePresets.presets.find(item => item.id === DEFAULT_PROMPT_LLM_PRESET_ID)!;
    // 内置预设自己在 NAI 语法说明里就写着 {{tag}}，不能按动态宏拦截。
    preset.messages = [
      { id: 'custom', title: '', role: 'system', content: '示例 {{tag}}、{{char}} 与 {{getvar::secret}} 都按字面发送' },
    ];
    const messages = await buildTheaterMessages(settings, makeRequest(), settings.novelai.model);
    expect(messages[0]!.content).toContain('{{tag}}');
    expect(messages[0]!.content).toContain('{{char}}');
    expect(messages[0]!.content).toContain('{{getvar::secret}}');

    preset.messages = [{ id: 'custom', title: '', role: 'system', content: '<%= currentCharacter %>' }];
    await expect(buildTheaterMessages(settings, makeRequest(), settings.novelai.model)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTEXT',
    });
  });

  it('rejects worldbook references and a missing per-request preset', async () => {
    const settings = makeSettings();
    settings.promptLlmMessagePresets.presets.find(preset => preset.id === DEFAULT_PROMPT_LLM_PRESET_ID)!.messages = [
      {
        id: 'worldbook_entry:test',
        title: '角色世界书',
        role: 'system',
        content: '',
        reference: { worldbookName: 'current' },
      },
    ];
    await expect(buildTheaterMessages(settings, makeRequest(), settings.novelai.model)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTEXT',
    });
    await expect(
      buildTheaterMessages(settings, { ...makeRequest(), presetId: 'missing' }, settings.novelai.model),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('filters provider-specific rules and includes empty participants and history explicitly', async () => {
    const settings = makeSettings();
    const messages = await buildTheaterMessages(
      settings,
      { ...makeRequest(), imageSource: 'comfyui' },
      'workflow-model',
    );
    const joined = messages.map(message => message.content).join('\n');
    expect(joined).not.toContain('<nai_prompt_rules>');
    expect(joined).toContain('<comfyui_prompt_rules>');
    // 内置预设的焦点段落槽位收到的就是整篇正文，选景要求由末尾输出规则补充。
    expect(joined).toContain(`<main_scene>\n    ${THEATER_TEXT}\n</main_scene>`);
    expect(joined).toContain('theater_text 是尚未选景的完整作品');
    expect(JSON.parse(messages.at(-1)!.content)).toMatchObject({
      participants: '',
      history: [],
      theater_text: THEATER_TEXT,
    });
  });

  it('retains scene schema and character fields and parses fenced/tagged output', () => {
    const schema = buildTheaterJsonSchema();
    expect(schema.value.required).toEqual(
      expect.arrayContaining(['scene', 'positivePrompt', 'negativePrompt', 'characterPrompts']),
    );
    expect((schema.value.properties as Record<string, unknown>).scene).toBeDefined();
    const result = extractTheaterResult(
      `<output>\n\`\`\`json\n${JSON.stringify(LLM_RESULT)}\n\`\`\`\n</output>`,
      THEATER_TEXT,
    );
    expect(result).toEqual({
      scene: LLM_RESULT.scene,
      prompts: {
        positivePrompt: LLM_RESULT.positivePrompt,
        negativePrompt: LLM_RESULT.negativePrompt,
        characterPrompts: LLM_RESULT.characterPrompts,
      },
    });
  });

  it('requires an exact contiguous quote, including punctuation, and rejects multiple outputs', () => {
    const altered = {
      ...LLM_RESULT,
      scene: { summary: '两个时空的拼接', sourceExcerpt: '清晨，林站在山顶看日出。夜晚，林和叶在雨中的车站重逢。' },
    };
    expect(() => extractTheaterResult(JSON.stringify(altered), THEATER_TEXT)).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
    expect(() =>
      extractTheaterResult(
        JSON.stringify({ ...LLM_RESULT, scene: { summary: '夜雨', sourceExcerpt: EXCERPT.replace('。', '!') } }),
        THEATER_TEXT,
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
    expect(() =>
      extractTheaterResult(
        `<output>${JSON.stringify(LLM_RESULT)}</output><output>${JSON.stringify(LLM_RESULT)}</output>`,
        THEATER_TEXT,
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });
});
