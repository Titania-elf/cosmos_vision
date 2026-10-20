import { getRequestHeaders } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';

export type TranslationDirection = 'zh-en' | 'en-zh';
export type TranslationProvider = 'google' | 'deepl';

const TRANSLATION_TIMEOUT_MS = 30_000;
const GOOGLE_CHUNK_SIZE = 5000;

/** 将长文本按换行、标点或空格分段，避免超出 Google 单次请求限制。 */
function splitGoogleText(source: string): string[] {
  const chunks: string[] = [];
  let remaining = source;
  while (remaining.length > GOOGLE_CHUNK_SIZE) {
    const prefix = remaining.slice(0, GOOGLE_CHUNK_SIZE);
    const boundary = Math.max(
      prefix.lastIndexOf('\n'),
      prefix.lastIndexOf('，'),
      prefix.lastIndexOf(','),
      prefix.lastIndexOf(' '),
    );
    let end = boundary >= GOOGLE_CHUNK_SIZE / 2 ? boundary + 1 : GOOGLE_CHUNK_SIZE;
    // 不在 UTF-16 代理对中间截断。
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end -= 1;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * 使用酒馆的翻译服务接口，DeepL 密钥与 Free / Pro 设置沿用酒馆配置。
 * 只返回译文，不修改原文或调用提示词 LLM。
 */
export async function translateText(
  text: string,
  direction: TranslationDirection,
  provider: TranslationProvider = 'google',
  signal?: AbortSignal,
): Promise<string> {
  const source = text.trim();
  if (!source) return '';
  if (provider !== 'google' && provider !== 'deepl') throw new Error('不支持的翻译服务');

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TRANSLATION_TIMEOUT_MS);

  const name = provider === 'deepl' ? 'DeepL' : 'Google';
  const lang = direction === 'zh-en' ? 'en' : 'zh-CN';
  const translationSettings = extension_settings.translate as { deepl_endpoint?: string } | undefined;
  const endpoint = translationSettings?.deepl_endpoint === 'pro' ? 'pro' : 'free';

  try {
    const chunks = provider === 'google' ? splitGoogleText(source) : [source];
    const translations: string[] = [];
    for (const chunk of chunks) {
      controller.signal.throwIfAborted();
      const response = await fetch('/api/translate/' + provider, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ text: chunk, lang, ...(provider === 'deepl' ? { endpoint } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (provider === 'deepl' && response.status === 400) {
          throw new Error('请先在酒馆「扩展 → 聊天翻译」中配置 DeepL API 密钥');
        }
        const hint = provider === 'deepl' ? '，请检查 API 密钥、额度及 Free / Pro 设置' : '，请稍后重试';
        throw new Error(name + ' 翻译请求失败（HTTP ' + response.status + '）' + hint);
      }
      const translated = await response.text();
      if (!translated.trim()) throw new Error(name + ' 未返回译文，请重试');
      translations.push(translated);
    }
    controller.signal.throwIfAborted();
    return translations.join('');
  } catch (caught) {
    if (timedOut) throw new Error(name + ' 翻译超时，请重试');
    if (controller.signal.aborted) throw caught;
    if (caught instanceof TypeError) throw new Error('无法连接 ' + name + ' 翻译服务，请检查网络后重试');
    throw caught;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
