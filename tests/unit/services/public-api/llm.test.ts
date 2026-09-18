import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProvidedLlmError, requestProvidedPrompt, snapshotProvidedLlmConfig } from '@/services/public-api/llm';
import { buildTheaterJsonSchema } from '@/services/public-api/prompt';
import * as connectionSettings from '@/services/sillytavern/openai-config';
import { createMockFetch } from '../../../helpers/fetch-mocks';
import { LLM_RESULT, makeSettings } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const messages = [{ role: 'user' as const, content: 'provided {{char}} literal' }];

describe('isolated prompt LLM transport', () => {
  it('sends explicit messages directly to the ST backend with local settings and no global generation or macro calls', async () => {
    const settings = makeSettings();
    const fetch = createMockFetch(() => ({
      json: { choices: [{ message: { content: JSON.stringify(LLM_RESULT), reasoning_content: 'never return this' } }] },
    }));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal(
      'TavernHelper',
      new Proxy(
        {},
        {
          get() {
            throw new Error('隐式聊天读取');
          },
        },
      ),
    );
    const config = snapshotProvidedLlmConfig(settings.promptLlm);
    const controller = new AbortController();
    const output = await requestProvidedPrompt(config, messages, buildTheaterJsonSchema(), controller.signal);
    expect(JSON.parse(output)).toEqual(LLM_RESULT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/backends/chat-completions/generate');
    expect(init.signal).toBe(controller.signal);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      messages,
      stream: false,
      n: 1,
      model: 'test-llm',
      reverse_proxy: 'https://llm.example.test/v1',
      proxy_password: 'secret-llm-token',
    });
    expect(body.char_name).toBeUndefined();
    expect(body.assistant_prefill).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('snapshots proxy credentials before later global configuration changes', async () => {
    const settings = makeSettings();
    settings.promptLlm.accounts[0]!.proxyPreset = 'saved-proxy';
    const find = vi
      .spyOn(connectionSettings, 'findProxyPreset')
      .mockReturnValue({ name: 'saved-proxy', url: 'https://original.example/v1', password: 'original-secret' });
    const config = snapshotProvidedLlmConfig(settings.promptLlm);
    find.mockReturnValue({ name: 'saved-proxy', url: 'https://changed.example/v1', password: 'changed-secret' });
    const fetch = createMockFetch(() => ({
      json: { choices: [{ message: { content: JSON.stringify(LLM_RESULT) } }] },
    }));
    vi.stubGlobal('fetch', fetch);
    await requestProvidedPrompt(config, messages, undefined, new AbortController().signal);
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.reverse_proxy).toBe('https://original.example/v1');
    expect(body.proxy_password).toBe('original-secret');
  });

  it('does not silently fall back when a proxy preset is missing', () => {
    const settings = makeSettings();
    settings.promptLlm.accounts[0]!.proxyPreset = 'missing-proxy';
    expect(getProvidedLlmError(settings.promptLlm)).toBeTruthy();
    expect(() => snapshotProvidedLlmConfig(settings.promptLlm)).toThrow(
      expect.objectContaining({ code: 'LLM_NOT_CONFIGURED' }),
    );
  });

  it.each([
    {
      content: [
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'text', text: JSON.stringify(LLM_RESULT) },
      ],
    },
    { content: [{ type: 'tool_use', name: 'cosmos_vision_theater_output', input: LLM_RESULT }] },
    {
      candidates: [
        { content: { parts: [{ text: 'private reasoning', thought: true }, { text: JSON.stringify(LLM_RESULT) }] } },
      ],
    },
  ])('reads final text or schema output from provider-specific responses', async json => {
    vi.stubGlobal(
      'fetch',
      createMockFetch(() => ({ json })),
    );
    const output = await requestProvidedPrompt(
      snapshotProvidedLlmConfig(makeSettings().promptLlm),
      messages,
      buildTheaterJsonSchema(),
      new AbortController().signal,
    );
    expect(JSON.parse(output)).toEqual(LLM_RESULT);
  });

  it('rejects custom parameters that replace the supplied context or increase request count', () => {
    const settings = makeSettings();
    const account = settings.promptLlm.accounts[0]!;
    account.source = 'custom';
    account.customIncludeBody = 'messages: [{role: user, content: other chat}]';
    expect(() => snapshotProvidedLlmConfig(settings.promptLlm)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CONTEXT' }),
    );
    account.customIncludeBody = 'n: 5';
    expect(() => snapshotProvidedLlmConfig(settings.promptLlm)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CONTEXT' }),
    );
    account.customIncludeBody = '';
    account.customExcludeBody = '[messages]';
    expect(() => snapshotProvidedLlmConfig(settings.promptLlm)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CONTEXT' }),
    );
  });

  it('keeps failures local and does not retry another paid LLM call', async () => {
    const fetch = createMockFetch(() => ({ status: 500, text: 'Authorization: secret; raw private request' }));
    vi.stubGlobal('fetch', fetch);
    const error = await requestProvidedPrompt(
      snapshotProvidedLlmConfig(makeSettings().promptLlm),
      messages,
      undefined,
      new AbortController().signal,
    ).catch(error => error);
    expect(error.code).toBe('GENERATION_FAILED');
    expect(error.message).not.toMatch(/Authorization|secret|private/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects before submission when cancelled', async () => {
    const fetch = createMockFetch();
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestProvidedPrompt(
        snapshotProvidedLlmConfig(makeSettings().promptLlm),
        messages,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
