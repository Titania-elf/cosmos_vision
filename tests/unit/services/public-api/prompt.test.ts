import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTheaterJsonSchema, buildTheaterMessages, extractTheaterResult } from '@/services/public-api/prompt';
import { normalizePromptLlmMessagePresets } from '@/services/prompt-llm/message-preset';
import { DEFAULT_PROMPT_LLM_PRESET_ID } from '@/constants/default-prompt-llm-preset';
import { LLM_RESULT, makeRequest, makeSettings, THEATER_TEXT } from './fixtures';

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

  it('filters provider-specific rules and injects theater text via macros without the fallback user message', async () => {
    const settings = makeSettings();
    const request = { ...makeRequest(), imageSource: 'comfyui' as const };
    request.previousScenes = [{ summary: '山顶日出' }];
    const messages = await buildTheaterMessages(settings, request, 'workflow-model');
    const joined = messages.map(message => message.content).join('\n');
    expect(joined).not.toContain('<nai_prompt_rules>');
    expect(joined).toContain('<comfyui_prompt_rules>');
    // 内置预设的焦点段落槽位收到的就是整篇正文，选景要求由末尾输出规则补充。
    expect(joined).toContain(`<main_scene>\n    ${THEATER_TEXT}\n</main_scene>`);
    expect(joined).toContain('theater_text 是尚未选景的完整作品');
    // 既往画面经 {{previous_scenes}} 宏条目注入，避免重复选景的参考不丢。
    expect(joined).toContain(JSON.stringify(request.previousScenes));
    // 内置默认预设关闭原始素材兜底：不再附加末尾 user JSON，正文不被重复注入。
    expect(messages.at(-1)!.role).not.toBe('user');
    expect(messages.some(message => message.content.includes('"theater_text"'))).toBe(false);
  });

  it('appends the raw-context fallback user message for a custom preset lacking input macros', async () => {
    const settings = makeSettings();
    const request = makeRequest();
    request.previousScenes = [{ summary: '山顶日出' }];
    request.presetId = 'custom-theater';
    settings.promptLlmMessagePresets.presets.push({
      id: request.presetId,
      name: '自定义小剧场',
      // 未显式设置 appendProvidedContext：非默认预设默认开启兜底。
      messages: [{ id: 'custom', title: '测试', role: 'system', enabled: true, content: '自定义画风' }],
    });
    const messages = await buildTheaterMessages(settings, request, settings.novelai.model);
    const last = messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(JSON.parse(last.content)).toEqual({
      theater_text: THEATER_TEXT,
      participants: request.context.participants,
      history: request.context.history,
      special_request: request.specialRequest,
      previous_scenes: request.previousScenes,
    });
  });

  it('omits the fallback user message when a custom preset opts out explicitly', async () => {
    const settings = makeSettings();
    const request = { ...makeRequest(), presetId: 'macro-theater' };
    settings.promptLlmMessagePresets.presets.push({
      id: request.presetId,
      name: '含宏自定义预设',
      appendProvidedContext: false,
      messages: [{ id: 'custom', title: '测试', role: 'system', enabled: true, content: '画风 {{theater_text}}' }],
    });
    const messages = await buildTheaterMessages(settings, request, settings.novelai.model);
    expect(messages[0]!.content).toContain(THEATER_TEXT);
    expect(messages.at(-1)!.role).not.toBe('user');
    expect(messages.some(message => message.content.includes('"theater_text"'))).toBe(false);
  });

  it('retains scene schema and character fields and parses fenced/tagged output', () => {
    const schema = buildTheaterJsonSchema();
    expect(schema.value.required).toEqual(
      expect.arrayContaining(['scene', 'positivePrompt', 'negativePrompt', 'characterPrompts']),
    );
    expect((schema.value.properties as Record<string, unknown>).scene).toBeDefined();
    const result = extractTheaterResult(`<output>\n\`\`\`json\n${JSON.stringify(LLM_RESULT)}\n\`\`\`\n</output>`);
    expect(result).toEqual({
      scene: LLM_RESULT.scene,
      prompts: {
        positivePrompt: LLM_RESULT.positivePrompt,
        negativePrompt: LLM_RESULT.negativePrompt,
        characterPrompts: LLM_RESULT.characterPrompts,
      },
    });
  });

  it('accepts a summary without requiring a verbatim excerpt, but rejects empty positive and multiple outputs', () => {
    // 正文原文含半角引号时，逐字摘录会破坏 JSON；现在只要求模型给出概括 summary，不再逐字校验。
    const quoted = {
      ...LLM_RESULT,
      scene: { summary: '角色说“行，是我活该”，两人相拥。' },
    };
    expect(extractTheaterResult(JSON.stringify(quoted)).scene).toEqual(quoted.scene);
    // 正向提示词为空仍拒绝。
    expect(() =>
      extractTheaterResult(JSON.stringify({ ...LLM_RESULT, positivePrompt: '   ' })),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
    // 多个 <output> 仍拒绝。
    expect(() =>
      extractTheaterResult(`<output>${JSON.stringify(LLM_RESULT)}</output><output>${JSON.stringify(LLM_RESULT)}</output>`),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });
});
