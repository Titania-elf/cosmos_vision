import { extension_settings } from '@sillytavern/scripts/extensions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateText } from '@/services/translation/text-translation';

vi.mock('@sillytavern/script', () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }),
}));

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  extension_settings.translate = {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  extension_settings.translate = {};
});

describe('translateText 翻译服务', () => {
  it.each([
    ['zh-en', '一个女孩，微笑', 'en'],
    ['en-zh', '1girl, smile', 'zh-CN'],
  ] as const)('通过 Google 接口处理 %s，携带酒馆请求头', async (direction, source, lang) => {
    fetchMock.mockResolvedValue(new Response('translated'));
    expect(await translateText(source, direction)).toBe('translated');
    expect(fetchMock).toHaveBeenCalledWith('/api/translate/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' },
      body: JSON.stringify({ text: source, lang }),
      signal: expect.any(AbortSignal),
    });
  });

  it.each(['free', 'pro'] as const)('DeepL 沿用酒馆 %s 配置', async endpoint => {
    extension_settings.translate = { deepl_endpoint: endpoint };
    fetchMock.mockResolvedValue(new Response('一个女孩'));
    expect(await translateText('a girl', 'en-zh', 'deepl')).toBe('一个女孩');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/translate/deepl',
      expect.objectContaining({
        body: JSON.stringify({ text: 'a girl', lang: 'zh-CN', endpoint }),
      }),
    );
  });

  it('DeepL 没有端点配置时使用 Free', async () => {
    fetchMock.mockResolvedValue(new Response('a girl'));
    await translateText('一个女孩', 'zh-en', 'deepl');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      text: '一个女孩',
      lang: 'en',
      endpoint: 'free',
    });
  });

  it('保留服务返回的换行、引号和正文前缀', async () => {
    const translated = '中文："女孩"\n微笑';
    fetchMock.mockResolvedValue(new Response(translated));
    expect(await translateText('girl\nsmile', 'en-zh')).toBe(translated);
  });

  it('空文本不发起请求', async () => {
    expect(await translateText(' \n ', 'zh-en')).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('长文本分段请求不丢失字符且不截断 emoji', async () => {
    const source = 'a'.repeat(4999) + '😀\n' + 'long prompt, '.repeat(600);
    fetchMock.mockImplementation(async (_url, init) => new Response(JSON.parse(init!.body as string).text));
    expect(await translateText(source, 'en-zh')).toBe(source.trim());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    for (const [, init] of fetchMock.mock.calls) {
      const text = JSON.parse(init!.body as string).text as string;
      expect(text.length).toBeLessThanOrEqual(5000);
      expect(text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
  });

  it('DeepL 未配置密钥时提示配置位置', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Request', { status: 400 }));
    await expect(translateText('girl', 'en-zh', 'deepl')).rejects.toThrow('聊天翻译');
  });

  it('HTTP 错误不作为译文返回', async () => {
    fetchMock.mockResolvedValue(new Response('<html>error</html>', { status: 500 }));
    await expect(translateText('girl', 'en-zh')).rejects.toThrow('HTTP 500');
  });

  it('空响应提示重试', async () => {
    fetchMock.mockResolvedValue(new Response('  '));
    await expect(translateText('girl', 'en-zh')).rejects.toThrow('未返回译文');
  });

  it('网络失败给出可重试的错误', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(translateText('girl', 'en-zh')).rejects.toThrow('请检查网络后重试');
  });

  it('超时取消请求并提示重试', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const assertion = expect(translateText('girl', 'en-zh')).rejects.toThrow('翻译超时');
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('外部取消信号终止进行中的请求', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const assertion = expect(translateText('girl', 'en-zh', 'google', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await assertion;
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it('已取消的请求不再访问服务', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(translateText('girl', 'en-zh', 'google', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
