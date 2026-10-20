import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import {
  translateText,
  type TranslationDirection,
  type TranslationProvider,
} from '@/services/translation/text-translation';

export interface ManualTranslationOptions {
  visible: Readonly<Ref<boolean>>;
  provider: Readonly<Ref<TranslationProvider>>;
}

/** 含中文时译为英文，英文译为中文；空文本与纯符号不翻译。 */
function detectDirection(text: string): TranslationDirection | null {
  if (/[㐀-䶿一-鿿豈-﫿]/.test(text)) return 'zh-en';
  if (/[A-Za-z]/.test(text)) return 'en-zh';
  return null;
}

/** 仅由 translate 手动触发请求，输入、服务或可见性变化时清除旧译文。 */
export function useManualTranslation(source: Readonly<Ref<string>>, options: ManualTranslationOptions) {
  const text = ref('');
  const pending = ref(false);
  const error = ref('');
  const direction = computed(() => detectDirection(source.value));
  const targetLabel = computed(() =>
    direction.value === 'zh-en' ? '英文' : direction.value === 'en-zh' ? '中文' : '',
  );
  const canTranslate = computed(() => options.visible.value && Boolean(direction.value) && !pending.value);
  let generation = 0;
  let controller: AbortController | null = null;
  let disposed = false;

  function reset(): void {
    generation += 1;
    controller?.abort();
    controller = null;
    text.value = '';
    error.value = '';
    pending.value = false;
  }

  async function translate(): Promise<void> {
    const nextDirection = direction.value;
    if (disposed || !canTranslate.value || !nextDirection) return;
    const id = ++generation;
    controller = new AbortController();
    pending.value = true;
    text.value = '';
    error.value = '';
    try {
      const translated = await translateText(source.value, nextDirection, options.provider.value, controller.signal);
      if (id !== generation) return;
      text.value = translated;
    } catch (caught) {
      if (id !== generation) return;
      error.value = caught instanceof Error ? caught.message : '未知错误，请重试';
    } finally {
      if (id === generation) {
        pending.value = false;
        controller = null;
      }
    }
  }

  watch([source, options.visible, options.provider], reset, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    reset();
  });

  return { text, targetLabel, pending, error, canTranslate, translate };
}
