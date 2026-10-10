import { describe, expect, it } from 'vitest';
import {
  buildCustomApi,
  buildGenerateRawMessagesRequest,
  buildJsonSchema,
  decodeJsonStringEscapes,
  extractOutputBlock,
  getPromptLlmRequestError,
  parsePromptLlmOutput,
  readPromptLlmOutput,
  readPromptLlmOutputWithRules,
} from '@/services/tavern-helper/prompt-llm';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { createPromptLlmAccount } from '@/constants/prompt-llm';

describe('tavern-helper prompt-llm helper', () => {
  it('extracts output block from XML or code block', () => {
    expect(extractOutputBlock('Prefix <output> {"positive":"cat"} </output> Suffix')).toBe('{"positive":"cat"}');
    expect(extractOutputBlock('```json\n{"positive":"cat"}\n```')).toBe('{"positive":"cat"}');
  });

  it('parses output JSON', () => {
    const raw = JSON.stringify({ positive: 'masterpiece', negative: 'worst quality' });
    const parsed = parsePromptLlmOutput(raw, { positive: 'positive', negative: 'negative' });
    expect(parsed).toEqual({ positivePrompt: 'masterpiece', negativePrompt: 'worst quality' });
  });

  it('reads output using labeled fallback when JSON parsing fails', () => {
    const labeledText = 'positive: masterpiece, 1girl\nnegative: bad quality';
    const output = readPromptLlmOutput(labeledText);
    expect(output).toEqual({ positivePrompt: 'masterpiece, 1girl', negativePrompt: 'bad quality' });
  });

  it('decodes JSON \\n to a real newline even when JSON schema extraction is off (fields=null)', () => {
    const raw = `<output>${JSON.stringify({ positivePrompt: 'tag1, tag2,\nnatural sentence.', negativePrompt: '' })}</output>`;
    const output = readPromptLlmOutputWithRules(raw, DEFAULT_SETTINGS.promptLlm, null);
    expect(output).toEqual({ positivePrompt: 'tag1, tag2,\nnatural sentence.', negativePrompt: '' });
    expect(output?.positivePrompt).toContain('\n');
    expect(output?.positivePrompt).not.toContain('\\n');
  });

  it('falls back to the regex rule when the output block is not valid JSON', () => {
    const settings = {
      ...DEFAULT_SETTINGS.promptLlm,
      positivePromptExtractPattern: '/positive:\\s*([^\\n]+)/i',
      negativePromptExtractPattern: '/negative:\\s*([^\\n]+)/i',
    };
    const output = readPromptLlmOutputWithRules('positive: cat, dog\nnegative: blurry', settings, null);
    expect(output).toEqual({ positivePrompt: 'cat, dog', negativePrompt: 'blurry' });
  });

  it('decodes \\n in the regex fallback so the textarea shows real line breaks (not literal \\n)', () => {
    // 合法 JSON 但缺负面字段 -> 整体 JSON 路径判空回退正则；默认正则捕获到字面 \n 应被还原为真实换行
    const raw = '<output>{"positivePrompt": "tag1, tag2,\\nnatural sentence."}</output>';
    const output = readPromptLlmOutputWithRules(raw, DEFAULT_SETTINGS.promptLlm, null);
    expect(output?.positivePrompt).toBe('tag1, tag2,\nnatural sentence.');
    expect(output?.positivePrompt).not.toContain('\\n');
  });

  it('preserves danbooru parenthesis escaping (\\( \\)) while decoding whitespace escapes', () => {
    expect(decodeJsonStringEscapes('artist \\(style\\), 1girl\\nmasterpiece')).toBe('artist \\(style\\), 1girl\nmasterpiece');
    expect(decodeJsonStringEscapes('plain tags, no escapes')).toBe('plain tags, no escapes');
  });

  it('validates prompt llm request settings and builds custom api & json schema', () => {
    const account = createPromptLlmAccount('acc-1', 'http://localhost:8000/v1', 'sk-test');
    account.model = 'gpt-4o';
    const settings = { ...DEFAULT_SETTINGS.promptLlm, accounts: [account] };
    expect(getPromptLlmRequestError(settings)).toBeNull();

    const customApi = buildCustomApi(settings.accounts[0]);
    expect(customApi.model).toBe('gpt-4o');
    expect(customApi.apiurl).toBe('http://localhost:8000/v1');
    expect(customApi.key).toBe('sk-test');

    const schema = buildJsonSchema();
    expect(schema.name).toBe('cosmos_vision_prompt_output');

    const req = buildGenerateRawMessagesRequest([{ role: 'user', content: 'test' }], customApi, schema, true);
    expect(req.ordered_prompts).toHaveLength(1);
    expect(req.should_stream).toBe(true);
  });
});
