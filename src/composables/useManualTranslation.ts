import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import {
  translateText,
  type TranslationDirection,
  type TranslationProvider,
} from '@/services/translation/text-translation';

export interface ManualTranslationOptions {
  visible: Readonly<Ref<boolean>>;
  provider: Readonly<Ref<TranslationProvider>>;
  /** 用户点击回填按钮且翻译成功后，更新对应的上方输入框。 */
  onApply: (translatedText: string) => void;
}

/** 含中文时译为英文，英文译为中文；空文本与纯符号不翻译。 */
function detectDirection(text: string): TranslationDirection | null {
  if (/[㐀-䶿一-鿿豈-﫿]/.test(text)) return 'zh-en';
  if (/[A-Za-z]/.test(text)) return 'en-zh';
  return null;
}

/** 手动翻译并编辑译文，仅在用户点击回填按钮后将英文写入原输入框。 */
export function useManualTranslation(source: Readonly<Ref<string>>, options: ManualTranslationOptions) {
  const text = ref('');
  const hasTranslation = ref(false);
  const translationTargetLabel = ref('');
  const pending = ref(false);
  const applying = ref(false);
  const applied = ref(false);
  const error = ref('');
  const direction = computed(() => detectDirection(source.value));
  const targetLabel = computed(() =>
    direction.value === 'zh-en' ? '英文' : direction.value === 'en-zh' ? '中文' : '',
  );
  const canTranslate = computed(
    () => options.visible.value && Boolean(direction.value) && !pending.value && !applying.value,
  );
  const canApply = computed(
    () =>
      options.visible.value && hasTranslation.value && Boolean(text.value.trim()) && !pending.value && !applying.value,
  );
  let generation = 0;
  let controller: AbortController | null = null;
  let disposed = false;
  let expectedAppliedSource: string | null = null;

  function cancelRequest(): void {
    generation += 1;
    controller?.abort();
    controller = null;
    pending.value = false;
    applying.value = false;
  }

  function reset(): void {
    cancelRequest();
    expectedAppliedSource = null;
    text.value = '';
    hasTranslation.value = false;
    translationTargetLabel.value = '';
    error.value = '';
    applied.value = false;
  }

  async function translate(): Promise<void> {
    const nextDirection = direction.value;
    if (disposed || !canTranslate.value || !nextDirection) return;
    const id = ++generation;
    controller = new AbortController();
    pending.value = true;
    text.value = '';
    hasTranslation.value = false;
    translationTargetLabel.value = '';
    error.value = '';
    applied.value = false;
    try {
      const translated = await translateText(source.value, nextDirection, options.provider.value, controller.signal);
      if (id !== generation) return;
      text.value = translated;
      hasTranslation.value = true;
      translationTargetLabel.value = nextDirection === 'zh-en' ? '英文' : '中文';
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

  /** 固定译为英文，成功后回填；失败或草稿发生变化时保留输入并允许重试。 */
  async function translateAndApply(): Promise<void> {
    if (disposed || !canApply.value) return;
    const id = ++generation;
    controller = new AbortController();
    applying.value = true;
    applied.value = false;
    error.value = '';
    try {
      const translated = await translateText(text.value, 'zh-en', options.provider.value, controller.signal);
      if (id !== generation) return;
      if (!translated.trim()) throw new Error('翻译服务未返回英文译文，请重试');
      // 回填引起的原文变化保留编辑中的译文，以便继续修改。
      expectedAppliedSource = translated === source.value ? null : translated;
      options.onApply(translated);
      applied.value = true;
    } catch (caught) {
      if (id !== generation) return;
      expectedAppliedSource = null;
      error.value = caught instanceof Error ? caught.message : '未知错误，请重试';
    } finally {
      if (id === generation) {
        applying.value = false;
        controller = null;
      }
    }
  }

  watch(
    source,
    current => {
      if (expectedAppliedSource !== null && current === expectedAppliedSource) {
        expectedAppliedSource = null;
        return;
      }
      reset();
    },
    { flush: 'sync' },
  );
  watch([options.visible, options.provider], reset, { flush: 'sync' });
  watch(
    text,
    () => {
      if (applying.value) cancelRequest();
      applied.value = false;
      error.value = '';
    },
    { flush: 'sync' },
  );
  onScopeDispose(() => {
    disposed = true;
    reset();
  });

  return {
    text,
    hasTranslation,
    targetLabel,
    translationTargetLabel,
    pending,
    applying,
    applied,
    error,
    canTranslate,
    canApply,
    translate,
    translateAndApply,
  };
}
