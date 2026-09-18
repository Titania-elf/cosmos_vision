import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateComfyUIImagesFromResolvedRequest } from '@/services/comfyui/api';
import { buildComfyUIResolvedRequestFromPrompts } from '@/services/comfyui/request';
import {
  buildNovelAIResolvedRequestFromPrompts,
  generateNovelAIImagesFromResolvedRequest,
} from '@/services/novelai/api';
import { createMockFetch } from '../../../helpers/fetch-mocks';
import { makeSettings, pngBlob } from './fixtures';

afterEach(() => vi.unstubAllGlobals());

describe('public image transport guarantees', () => {
  it('submits one ComfyUI job and downloads only the requested output count', async () => {
    const settings = makeSettings().comfyui;
    const request = buildComfyUIResolvedRequestFromPrompts(
      settings,
      { positivePrompt: 'final prompt', negativePrompt: '' },
      { appendLoraTriggerWords: false, batchSize: 1 },
    );
    const fetch = createMockFetch(url => {
      if (url.endsWith('/prompt')) return { json: { prompt_id: 'own-prompt' } };
      if (url.includes('/history/'))
        return {
          json: {
            'own-prompt': { outputs: { '7': { images: [{ filename: 'first.png' }, { filename: 'extra.png' }] } } },
          },
        };
      if (url.includes('/view?')) return { blob: pngBlob() };
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetch);
    const images = await generateComfyUIImagesFromResolvedRequest(settings, request, {
      interruptOnAbort: false,
      maxImages: 1,
      onDownloading() {
        throw new Error('callback failed');
      },
    });
    expect(images).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/prompt'))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => url.includes('/view?'))).toHaveLength(1);
    expect(fetch.mock.calls.find(([url]) => url.includes('/view?'))![0]).toContain('first.png');
  });

  it('cancels only the public ComfyUI wait while an unrelated job completes', async () => {
    const settings = makeSettings().comfyui;
    const prompts = { positivePrompt: 'prompt', negativePrompt: '' };
    const first = buildComfyUIResolvedRequestFromPrompts(settings, prompts);
    const second = buildComfyUIResolvedRequestFromPrompts(settings, prompts);
    let submitted = 0;
    const fetch = createMockFetch((url, init) => {
      if (url.endsWith('/prompt')) return { json: { prompt_id: ++submitted === 1 ? 'public' : 'ordinary' } };
      if (url.endsWith('/history/public'))
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException('cancelled', 'AbortError'));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        });
      if (url.endsWith('/history/ordinary'))
        return { json: { ordinary: { outputs: { '7': { images: [{ filename: 'ordinary.png' }] } } } } };
      if (url.includes('/view?')) return { blob: pngBlob() };
      throw new Error('unrelated backend must not be interrupted');
    });
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const publicRequest = generateComfyUIImagesFromResolvedRequest(settings, first, {
      signal: controller.signal,
      interruptOnAbort: false,
    });
    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url.endsWith('/history/public'))).toBe(true));
    const ordinaryRequest = generateComfyUIImagesFromResolvedRequest(settings, second);
    const rejected = expect(publicRequest).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    await expect(ordinaryRequest).resolves.toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/interrupt'))).toBe(false);
    expect(submitted).toBe(2);
  });

  it('does not fail over NovelAI to a second account after an uncertain paid request failure', async () => {
    const settings = makeSettings().novelai;
    settings.accounts.push({ ...settings.accounts[0]!, id: 'second', url: 'https://second.example.test' });
    const request = buildNovelAIResolvedRequestFromPrompts(settings, { positivePrompt: 'final', negativePrompt: '' });
    const fetch = createMockFetch(() => ({ status: 502, text: 'upstream disconnected' }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      generateNovelAIImagesFromResolvedRequest(request, 1, { allowAccountFallback: false }),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(body.parameters.n_samples).toBe(1);
    expect(body.input).toBe('final');
  });

  it('preserves account fallback for ordinary NovelAI generation', async () => {
    const settings = makeSettings().novelai;
    settings.accounts.push({ ...settings.accounts[0]!, id: 'second', url: 'https://second.example.test' });
    const request = buildNovelAIResolvedRequestFromPrompts(settings, { positivePrompt: 'final', negativePrompt: '' });
    const fetch = createMockFetch(url =>
      url.includes('second.example.test')
        ? { headers: { 'content-type': 'application/json' }, json: { images: [{ image: 'aGVsbG8=' }] } }
        : { status: 500 },
    );
    vi.stubGlobal('fetch', fetch);
    await expect(generateNovelAIImagesFromResolvedRequest(request, 1)).resolves.toHaveProperty('imageBlobs');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
