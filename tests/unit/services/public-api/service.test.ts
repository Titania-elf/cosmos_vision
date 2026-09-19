import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createCosmosVisionPublicApi } from '@/services/public-api/service';
import { PublicApiError } from '@/services/public-api/errors';
import { requestProvidedPrompt } from '@/services/public-api/llm';
import { generateNovelAIImagesFromResolvedRequest, buildPayload } from '@/services/novelai/api';
import { generateComfyUIImagesFromResolvedRequest } from '@/services/comfyui/api';
import { getComfyUIModelId } from '@/services/public-api/providers';
import { MAX_TEXT_CHARS } from '@/services/public-api/validation';
import { useLlmInspectorStore } from '@/store/llm-inspector';
import type { GenerateRequest, PreparePromptRequest } from '@/services/public-api/types';
import type { NovelAIImagesResult } from '@/services/novelai/types';
import { deferred, LLM_RESULT, makeDraft, makeRequest, makeSettings, pngBlob, THEATER_TEXT } from './fixtures';

vi.mock('@/services/public-api/llm', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/public-api/llm')>()),
  requestProvidedPrompt: vi.fn(),
}));
vi.mock('@/services/novelai/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/novelai/api')>()),
  generateNovelAIImagesFromResolvedRequest: vi.fn(),
}));
vi.mock('@/services/comfyui/api', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/comfyui/api')>()),
  generateComfyUIImagesFromResolvedRequest: vi.fn(),
}));

const llm = vi.mocked(requestProvidedPrompt);
const novelai = vi.mocked(generateNovelAIImagesFromResolvedRequest);
const comfyui = vi.mocked(generateComfyUIImagesFromResolvedRequest);
const bitmapClose = vi.fn();

beforeEach(() => {
  llm.mockReset().mockResolvedValue(JSON.stringify(LLM_RESULT));
  novelai.mockReset().mockImplementation(async (request, _count, options) => {
    options?.onDownloading?.();
    return { imageBlobs: [pngBlob()], snapshot: request.snapshot, prompts: request.prompts };
  });
  comfyui.mockReset().mockImplementation(async (_settings, _request, options) => {
    options?.onDownloading?.();
    return [pngBlob(), pngBlob()];
  });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 640, height: 480, close: bitmapClose })),
  );
  vi.stubGlobal(
    'TavernHelper',
    new Proxy(
      {},
      {
        get() {
          throw new Error('不允许读取当前聊天或宏');
        },
      },
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CosmosVision public API', () => {
  it('reports initialization, disabled state and per-provider configuration without requests', async () => {
    const unavailable = createCosmosVisionPublicApi(() => undefined);
    expect(await unavailable.getCapabilities()).toMatchObject({ apiVersion: '1.0', ready: false, enabled: false });
    await expect(unavailable.preparePrompt(makeRequest(), { requestId: 'not-ready' })).rejects.toMatchObject({
      code: 'NOT_READY',
    });
    const settings = makeSettings();
    const api = createCosmosVisionPublicApi(() => settings);
    settings.novelai.accounts[0]!.apiKey = '';
    const capabilities = await api.getCapabilities();
    expect(capabilities.imageSources.map(source => source.ready)).toEqual([false, true]);
    expect(capabilities.limits).toEqual({ maxImages: 1, maxTextChars: MAX_TEXT_CHARS });
    settings.enabled = false;
    expect(await api.getCapabilities()).toMatchObject({ enabled: false });
    await expect(api.preparePrompt(makeRequest(), { requestId: 'disabled' })).rejects.toMatchObject({
      code: 'DISABLED',
    });
    await expect(api.generate({ draft: makeDraft(), count: 1 }, { requestId: 'disabled-image' })).rejects.toMatchObject(
      { code: 'DISABLED' },
    );
    expect(llm).not.toHaveBeenCalled();
    expect(novelai).not.toHaveBeenCalled();
    expect(comfyui).not.toHaveBeenCalled();
  });

  it('reports missing image and LLM configuration before starting requests', async () => {
    const settings = makeSettings();
    const api = createCosmosVisionPublicApi(() => settings);
    settings.novelai.accounts = [];
    await expect(api.preparePrompt(makeRequest(), { requestId: 'provider' })).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
    settings.novelai = makeSettings().novelai;
    settings.promptLlm.accounts = [];
    await expect(api.preparePrompt(makeRequest(), { requestId: 'llm' })).rejects.toMatchObject({
      code: 'LLM_NOT_CONFIGURED',
    });
    // 已持有草稿的生图无需 LLM。
    await expect(api.generate({ draft: makeDraft(), count: 1 }, { requestId: 'draft-only' })).resolves.toMatchObject({
      requestId: 'draft-only',
    });
    expect(llm).not.toHaveBeenCalled();
  });

  it('prepares from full provided text, preserves scene/characters and never generates images', async () => {
    const settings = makeSettings();
    settings.artistTagPool = {
      enabled: true,
      entries: [{ id: 'artist', name: '画风', text: 'artist:test', enabled: true }],
    };
    const before = JSON.stringify(settings);
    const request = makeRequest();
    request.context.participants = '林的黑发；叶穿红外套。{{char}} 是正文里的字面文本。';
    request.context.history = ['仅调用方历史'];
    request.previousScenes = [{ summary: '山顶日出' }];
    request.specialRequest = '远景，冷色';
    const api = createCosmosVisionPublicApi(() => settings);
    const progress = vi.fn();
    const draft = await api.preparePrompt(request, { requestId: 'prepare-a', onProgress: progress });
    expect(draft.scene.summary).toBe(LLM_RESULT.scene.summary);
    expect(draft.prompts.characterPrompts).toEqual(LLM_RESULT.characterPrompts);
    expect(draft.prompts.positivePrompt).toContain('artist:test');
    expect(JSON.parse(JSON.stringify(draft))).toEqual(draft);
    // 内置默认预设自带宏注入素材，不再附加末尾兜底 user 消息；素材应经各宏条目送达。
    const sentMessages = llm.mock.calls[0]![1];
    expect(sentMessages.at(-1)!.role).not.toBe('user');
    const joined = sentMessages.map(message => message.content).join('\n');
    expect(joined).toContain(request.theaterText);
    expect(joined).toContain(request.context.participants);
    expect(joined).toContain(request.specialRequest);
    expect(joined).toContain(JSON.stringify(request.previousScenes));
    // 兜底 user JSON 不应出现，正文不被重复注入。
    expect(sentMessages.some(message => message.content.includes('"theater_text"'))).toBe(false);
    expect(progress.mock.calls.map(([event]) => [event.requestId, event.stage])).toEqual([
      ['prepare-a', 'queued'],
      ['prepare-a', 'analyzing'],
    ]);
    expect(JSON.stringify(settings)).toBe(before);
    expect(novelai).not.toHaveBeenCalled();
    expect(comfyui).not.toHaveBeenCalled();
  });

  it('uses edited final text and normalized character coordinates without reapplying presets', async () => {
    const settings = makeSettings();
    const api = createCosmosVisionPublicApi(() => settings);
    const draft = await api.preparePrompt(makeRequest(), { requestId: 'prepare' });
    draft.prompts.positivePrompt = 'my exact edited positive';
    draft.prompts.negativePrompt = 'my exact edited negative';
    draft.prompts.characterPrompts[0]!.positivePrompt = 'edited character';
    settings.artistTagPool = {
      enabled: true,
      entries: [{ id: 'new', name: '新画风', text: 'must-not-append', enabled: true }],
    };
    const result = await api.generate(
      { draft: JSON.parse(JSON.stringify(draft)), count: 1 },
      { requestId: 'generate' },
    );
    const [sent, count, options] = novelai.mock.calls[0]!;
    expect(count).toBe(1);
    expect(options?.allowAccountFallback).toBe(false);
    expect(sent.prompts.positivePrompt).toBe(draft.prompts.positivePrompt);
    expect(sent.prompts.negativePrompt).toBe(draft.prompts.negativePrompt);
    const body = buildPayload(sent.settings, sent.prompts, sent.seed, count);
    expect(body.parameters.characterPrompts).toMatchObject([{ prompt: 'edited character', center: { x: 0, y: 1 } }]);
    expect(result).toMatchObject({
      requestId: 'generate',
      draft,
      images: [{ mimeType: 'image/png', width: 640, height: 480, seed: sent.seed }],
    });
    expect(result.images[0]!.blob).toBeInstanceOf(Blob);
    expect(bitmapClose).toHaveBeenCalled();
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('supports serialized draft reuse after reload and snapshots settings, input and request ID before callbacks', async () => {
    const settings = makeSettings();
    const draft = makeDraft(settings);
    const width = settings.novelai.width;
    const input = { draft, count: 1 };
    const control = {
      requestId: 'original-id',
      onProgress: vi.fn((event: { stage: string }) => {
        if (event.stage !== 'queued') return;
        settings.novelai.width = 1024;
        input.draft.prompts.positivePrompt = 'late mutation';
        control.requestId = 'late-id';
      }),
    };
    const api = createCosmosVisionPublicApi(() => settings);
    const result = await api.generate(input, control);
    expect(novelai.mock.calls[0]![0].settings.width).toBe(width);
    expect(result.draft.prompts.positivePrompt).toBe('edited prompt');
    expect(result.requestId).toBe('original-id');
    const restored = JSON.parse(JSON.stringify(result.draft));
    await api.generate({ draft: restored, count: 1 }, { requestId: 'repeat' });
    await createCosmosVisionPublicApi(() => settings).generate(
      { draft: restored, count: 1 },
      { requestId: 'after-reload' },
    );
    expect(novelai).toHaveBeenCalledTimes(3);
    expect(llm).not.toHaveBeenCalled();
  });

  it.each([
    ['UNSUPPORTED_MODE', { mode: 'paragraph' }],
    ['UNSUPPORTED_CONTEXT', { context: { mode: 'current' } }],
    ['INVALID_REQUEST', { theaterText: '' }],
    ['INVALID_REQUEST', { imageSource: 'unknown' }],
    ['TEXT_TOO_LONG', { theaterText: '文'.repeat(MAX_TEXT_CHARS + 1) }],
  ])('rejects invalid input with %s', async (code, changes) => {
    const api = createCosmosVisionPublicApi(makeSettings);
    await expect(
      api.preparePrompt({ ...makeRequest(), ...changes } as PreparePromptRequest, { requestId: 'invalid' }),
    ).rejects.toMatchObject({ code });
    expect(llm).not.toHaveBeenCalled();
  });

  it('counts provided history toward the text limit and rejects unsupported image counts', async () => {
    const api = createCosmosVisionPublicApi(makeSettings);
    const request = makeRequest();
    request.context.history = ['文'.repeat(MAX_TEXT_CHARS)];
    await expect(api.preparePrompt(request, { requestId: 'long-history' })).rejects.toMatchObject({
      code: 'TEXT_TOO_LONG',
    });
    await expect(api.generate({ draft: makeDraft(), count: 2 }, { requestId: 'count' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    const draft = makeDraft();
    draft.prompts.characterPrompts[0]!.position.x = 4;
    await expect(api.generate({ draft, count: 1 }, { requestId: 'coords' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    expect(novelai).not.toHaveBeenCalled();
  });

  it.each([
    ['NO_SCENE', JSON.stringify({ scene: null, positivePrompt: '', negativePrompt: '', characterPrompts: [] })],
    ['INVALID_RESPONSE', 'not json'],
    ['INVALID_RESPONSE', JSON.stringify({ ...LLM_RESULT, scene: { summary: '  ' } })],
    ['INVALID_RESPONSE', JSON.stringify({ ...LLM_RESULT, positivePrompt: ' ' })],
    ['INVALID_RESPONSE', JSON.stringify({ ...LLM_RESULT, characterPrompts: null })],
  ])('validates LLM output (%s) before any image request', async (code, output) => {
    llm.mockResolvedValue(output);
    await expect(
      createCosmosVisionPublicApi(makeSettings).preparePrompt(makeRequest(), { requestId: 'output' }),
    ).rejects.toMatchObject({ code });
    expect(novelai).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs during and after a task and isolates another request with BUSY', async () => {
    const pending = deferred<string>();
    llm.mockReturnValue(pending.promise);
    const api = createCosmosVisionPublicApi(makeSettings);
    const first = api.preparePrompt(makeRequest(), { requestId: 'same' });
    await expect(api.preparePrompt(makeRequest(), { requestId: 'same' })).rejects.toMatchObject({
      code: 'DUPLICATE_REQUEST',
    });
    await expect(api.generate({ draft: makeDraft(), count: 1 }, { requestId: 'other' })).rejects.toMatchObject({
      code: 'BUSY',
    });
    pending.resolve(JSON.stringify(LLM_RESULT));
    await first;
    await expect(api.generate({ draft: makeDraft(), count: 1 }, { requestId: 'same' })).rejects.toMatchObject({
      code: 'DUPLICATE_REQUEST',
    });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(novelai).not.toHaveBeenCalled();
  });

  it('rejects a pre-aborted call and an abort in the queued callback before any request', async () => {
    const api = createCosmosVisionPublicApi(makeSettings);
    const first = new AbortController();
    first.abort();
    await expect(api.preparePrompt(makeRequest(), { requestId: 'pre', signal: first.signal })).rejects.toMatchObject({
      name: 'AbortError',
      code: 'ABORTED',
    });
    const second = new AbortController();
    await expect(
      api.generate(
        { draft: makeDraft(), count: 1 },
        { requestId: 'queued', signal: second.signal, onProgress: () => second.abort() },
      ),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    expect(llm).not.toHaveBeenCalled();
    expect(novelai).not.toHaveBeenCalled();
  });

  it('aborts LLM waiting promptly, removes listeners and discards late results', async () => {
    const pending = deferred<string>();
    llm.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const progress = vi.fn();
    const api = createCosmosVisionPublicApi(makeSettings);
    const result = api.preparePrompt(makeRequest(), {
      requestId: 'cancel',
      signal: controller.signal,
      onProgress: progress,
    });
    await vi.waitFor(() => expect(llm).toHaveBeenCalledTimes(1));
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError', code: 'ABORTED' });
    controller.abort();
    await rejected;
    expect(llm.mock.calls[0]![3].aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    const count = progress.mock.calls.length;
    pending.resolve(JSON.stringify(LLM_RESULT));
    await Promise.resolve();
    await Promise.resolve();
    expect(progress).toHaveBeenCalledTimes(count);
    llm.mockResolvedValue(JSON.stringify(LLM_RESULT));
    await expect(api.preparePrompt(makeRequest(), { requestId: 'next' })).resolves.toHaveProperty('scene');
  });

  it('aborts image waiting without late results and preserves a single submission', async () => {
    const pending = deferred<NovelAIImagesResult>();
    novelai.mockReturnValue(pending.promise);
    const controller = new AbortController();
    const progress = vi.fn();
    const result = createCosmosVisionPublicApi(makeSettings).generate(
      { draft: makeDraft(), count: 1 },
      { requestId: 'cancel-image', signal: controller.signal, onProgress: progress },
    );
    await vi.waitFor(() => expect(novelai).toHaveBeenCalledTimes(1));
    const rejected = expect(result).rejects.toMatchObject({ code: 'ABORTED' });
    controller.abort();
    await rejected;
    const [request, , options] = novelai.mock.calls[0]!;
    const count = progress.mock.calls.length;
    options?.onDownloading?.();
    pending.resolve({ imageBlobs: [pngBlob()], snapshot: request.snapshot, prompts: request.prompts });
    await Promise.resolve();
    await Promise.resolve();
    expect(progress).toHaveBeenCalledTimes(count);
    expect(novelai).toHaveBeenCalledTimes(1);
  });

  it('times out even if the provider ignores abort and disposes timers', async () => {
    vi.useFakeTimers();
    const settings = makeSettings();
    settings.promptLlm.timeout = 1;
    llm.mockReturnValue(new Promise(() => {}));
    const pending = createCosmosVisionPublicApi(() => settings).preparePrompt(makeRequest(), { requestId: 'timeout' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1001);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry when progress callbacks throw', async () => {
    const api = createCosmosVisionPublicApi(makeSettings);
    const onProgress = () => {
      throw new Error('caller failed');
    };
    await api.preparePrompt(makeRequest(), { requestId: 'progress-prepare', onProgress });
    await api.generate({ draft: makeDraft(), count: 1 }, { requestId: 'progress-generate', onProgress });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(novelai).toHaveBeenCalledTimes(1);
  });

  it('returns only whitelisted fields and sanitizes remote errors', async () => {
    const settings = makeSettings();
    const api = createCosmosVisionPublicApi(() => settings);
    const draft = { ...makeDraft(), secret: 'private', endpoint: 'https://example.test/?key=private' };
    const result = await api.generate({ draft, count: 1 } as GenerateRequest, { requestId: 'safe' });
    const output = JSON.stringify(result);
    expect(output).not.toMatch(/secret|endpoint|apiKey|apiUrl|private/);
    expect(Object.keys(result.draft)).toEqual(['version', 'imageSource', 'model', 'scene', 'prompts']);
    novelai.mockRejectedValue(new Error('Authorization: Bearer secret-novelai-token https://images.test?key=private'));
    const error = await api.generate({ draft, count: 1 }, { requestId: 'failed' }).catch(error => error);
    expect(error).toMatchObject({ code: 'GENERATION_FAILED' });
    expect(error.message).not.toMatch(/secret|private|Authorization|https:/);
    expect(error.cause).toBeUndefined();
  });

  it('rejects a changed NovelAI model before generating', async () => {
    const settings = makeSettings();
    const draft = makeDraft(settings);
    settings.novelai.model = 'nai-diffusion-3';
    await expect(
      createCosmosVisionPublicApi(() => settings).generate({ draft, count: 1 }, { requestId: 'changed' }),
    ).rejects.toMatchObject({ code: 'CONFIG_CHANGED' });
    expect(novelai).not.toHaveBeenCalled();
  });

  it('deduplicates in-flight paid generation and keeps failed IDs from resubmitting', async () => {
    const pending = deferred<NovelAIImagesResult>();
    novelai.mockReturnValue(pending.promise);
    const api = createCosmosVisionPublicApi(makeSettings);
    const input = { draft: makeDraft(), count: 1 };
    const first = api.generate(input, { requestId: 'paid-once' });
    await expect(api.generate(input, { requestId: 'paid-once' })).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
    const rejected = expect(first).rejects.toMatchObject({ code: 'GENERATION_FAILED' });
    pending.reject(new Error('upstream disconnected after submission'));
    await rejected;
    await expect(api.generate(input, { requestId: 'paid-once' })).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
    expect(novelai).toHaveBeenCalledTimes(1);
  });

  it('rejects empty provider output and returns the normalized prompts actually sent', async () => {
    const api = createCosmosVisionPublicApi(makeSettings);
    const draft = makeDraft();
    draft.prompts.positivePrompt = '  final text  ';
    const result = await api.generate({ draft, count: 1 }, { requestId: 'normalized' });
    expect(result.draft.prompts.positivePrompt).toBe('final text');
    expect(novelai.mock.calls[0]![0].prompts.positivePrompt).toBe('final text');
    novelai.mockImplementation(async request => ({
      imageBlobs: [],
      snapshot: request.snapshot,
      prompts: request.prompts,
    }));
    await expect(api.generate({ draft, count: 1 }, { requestId: 'empty' })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('uses ComfyUI final prompts, crops outputs and passes safe cancellation options', async () => {
    const settings = makeSettings();
    llm.mockResolvedValue(JSON.stringify({ ...LLM_RESULT, characterPrompts: [] }));
    const api = createCosmosVisionPublicApi(() => settings);
    const draft = await api.preparePrompt({ ...makeRequest(), imageSource: 'comfyui' }, { requestId: 'comfy-prepare' });
    draft.prompts.positivePrompt = 'edited comfy';
    const before = JSON.stringify(settings);
    const result = await api.generate({ draft, count: 1 }, { requestId: 'comfy-generate' });
    const [, request, options] = comfyui.mock.calls[0]!;
    expect(request.workflow['2']!.inputs.text).toBe('edited comfy');
    expect(request.workflow['5']!.inputs.batch_size).toBe(1);
    expect(options).toMatchObject({ interruptOnAbort: false, maxImages: 1 });
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.seed).toBe(123);
    expect(JSON.stringify(settings)).toBe(before);
  });

  it('invalidates changed workflow models but accepts runtime parameter changes', async () => {
    const settings = makeSettings();
    const draft = { ...makeDraft(), imageSource: 'comfyui' as const, model: getComfyUIModelId(settings.comfyui) };
    draft.prompts.characterPrompts = [];
    const preset = settings.comfyui.workflowPresets.presets[0]!;
    const workflow = JSON.parse(preset.workflowJson);
    workflow['4'].inputs.steps = 32;
    workflow['5'].inputs.width = 1024;
    preset.workflowJson = JSON.stringify(workflow, null, 2);
    expect(getComfyUIModelId(settings.comfyui)).toBe(draft.model);
    const api = createCosmosVisionPublicApi(() => settings);
    await api.generate({ draft, count: 1 }, { requestId: 'same-model' });
    workflow['1'].inputs.ckpt_name = 'different-model.safetensors';
    preset.workflowJson = JSON.stringify(workflow);
    await expect(api.generate({ draft, count: 1 }, { requestId: 'new-model' })).rejects.toMatchObject({
      code: 'CONFIG_CHANGED',
    });
    expect(comfyui).toHaveBeenCalledTimes(1);
  });

  it('rejects avatar-bound workflows for prepare and generate without reading avatars', async () => {
    const settings = makeSettings();
    const draft = { ...makeDraft(), imageSource: 'comfyui' as const, model: getComfyUIModelId(settings.comfyui) };
    const preset = settings.comfyui.workflowPresets.presets[0]!;
    const workflow = JSON.parse(preset.workflowJson);
    workflow['8'] = {
      class_type: 'LoadImage',
      inputs: { image: '' },
      _meta: { cosmosVision: { imageBindings: { image: 'character-avatar' } } },
    };
    preset.workflowJson = JSON.stringify(workflow);
    const api = createCosmosVisionPublicApi(() => settings);
    expect((await api.getCapabilities()).imageSources[1]!.ready).toBe(false);
    await expect(
      api.preparePrompt({ ...makeRequest(), imageSource: 'comfyui' }, { requestId: 'avatar-prepare' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTEXT' });
    await expect(api.generate({ draft, count: 1 }, { requestId: 'avatar-image' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTEXT',
    });
    expect(comfyui).not.toHaveBeenCalled();
    expect(llm).not.toHaveBeenCalled();
  });

  it('records the theater request in the LLM inspector without credentials', async () => {
    setActivePinia(createPinia());
    const api = createCosmosVisionPublicApi(() => makeSettings());
    await api.preparePrompt(makeRequest(), { requestId: 'inspector-ok' });
    const session = useLlmInspectorStore().sessions.find(item => item.id === 'inspector-ok')!;
    expect(session.status).toBe('completed');
    expect(session.label).toContain('小剧场选景：');
    expect(session.model).toBe('test-llm');
    expect(session.endpoint).toBe('https://llm.example.test/v1');
    expect(session.streamEnabled).toBe(false);
    // 监视里能看到实际发送的指令与模型返回，但不含任何凭据。
    expect(session.prompts.map(prompt => prompt.content).join('\n')).toContain(THEATER_TEXT);
    expect(session.contentText).toContain('rainy station');
    expect(JSON.stringify(session)).not.toContain('secret-llm-token');
  });

  it('marks the inspector session failed when the provided request fails', async () => {
    setActivePinia(createPinia());
    llm.mockRejectedValue(new PublicApiError('GENERATION_FAILED', '提示词服务请求失败（HTTP 500）。'));
    const api = createCosmosVisionPublicApi(() => makeSettings());
    await expect(api.preparePrompt(makeRequest(), { requestId: 'inspector-fail' })).rejects.toMatchObject({
      code: 'GENERATION_FAILED',
    });
    const session = useLlmInspectorStore().sessions.find(item => item.id === 'inspector-fail')!;
    expect(session.status).toBe('failed');
    expect(session.error).toContain('HTTP 500');
  });
});
