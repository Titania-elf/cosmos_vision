import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, type EffectScope } from 'vue';
import { useManualTranslation } from '@/composables/useManualTranslation';
import { translateText, type TranslationProvider } from '@/services/translation/text-translation';

vi.mock('@/services/translation/text-translation', () => ({
  translateText: vi.fn(),
}));

const scopes: EffectScope[] = [];
function createTranslation(initial = 'a girl', visible = ref(true)) {
  const source = ref(initial);
  const provider = ref<TranslationProvider>('google');
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => useManualTranslation(source, { visible, provider }))!;
  return { source, provider, visible, state, scope };
}

beforeEach(() => {
  vi.mocked(translateText).mockReset();
  vi.mocked(translateText).mockImplementation(async text => 'translated:' + text);
});

afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
});

describe('useManualTranslation 手动翻译', () => {
  it('打开、输入、切换服务和重新打开都不自动发起请求', () => {
    const { source, provider, visible, state } = createTranslation();
    source.value = '一个女孩';
    provider.value = 'deepl';
    visible.value = false;
    visible.value = true;
    expect(state.pending.value).toBe(false);
    expect(state.text.value).toBe('');
    expect(translateText).not.toHaveBeenCalled();
  });

  it.each([
    ['一个女孩', 'zh-en', '英文'],
    ['a girl', 'en-zh', '中文'],
    ['a girl，微笑', 'zh-en', '英文'],
  ])('手动翻译 %s，只更新译文', async (sourceText, direction, label) => {
    const { source, state } = createTranslation(sourceText);
    await state.translate();
    expect(translateText).toHaveBeenCalledWith(sourceText, direction, 'google', expect.any(AbortSignal));
    expect(state.targetLabel.value).toBe(label);
    expect(state.text.value).toBe('translated:' + sourceText);
    expect(source.value).toBe(sourceText);
  });

  it('修改输入后清除旧译文，等待再次手动触发', async () => {
    const { source, state } = createTranslation();
    await state.translate();
    source.value = 'a smiling girl';
    expect(state.text.value).toBe('');
    expect(translateText).toHaveBeenCalledTimes(1);
    await state.translate();
    expect(state.text.value).toBe('translated:a smiling girl');
  });

  it('翻译进行中重复点击不会重复请求', async () => {
    let resolve!: (text: string) => void;
    vi.mocked(translateText).mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const { state } = createTranslation();
    const request = state.translate();
    expect(state.pending.value).toBe(true);
    expect(state.canTranslate.value).toBe(false);
    await state.translate();
    expect(translateText).toHaveBeenCalledTimes(1);
    resolve('女孩');
    await request;
    expect(state.pending.value).toBe(false);
  });

  it('修改输入后取消旧请求，即使旧响应晚到也不覆盖新结果', async () => {
    let resolve!: (text: string) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const { source, state } = createTranslation();
    const oldRequest = state.translate();
    const signal = vi.mocked(translateText).mock.calls[0][3]!;
    source.value = 'a smiling girl';
    expect(signal.aborted).toBe(true);
    await state.translate();
    resolve('旧译文');
    await oldRequest;
    expect(state.text.value).toBe('translated:a smiling girl');
  });

  it('切换服务使旧请求失效，新点击使用新服务', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    const { provider, state } = createTranslation();
    const oldRequest = state.translate();
    const signal = vi.mocked(translateText).mock.calls[0][3]!;
    provider.value = 'deepl';
    expect(signal.aborted).toBe(true);
    await state.translate();
    reject(new Error('旧请求错误'));
    await oldRequest;
    expect(state.error.value).toBe('');
    expect(state.text.value).toBe('translated:a girl');
    expect(translateText).toHaveBeenLastCalledWith('a girl', 'en-zh', 'deepl', expect.any(AbortSignal));
  });

  it('关闭弹窗后取消请求并忽略旧结果，重新打开仍需点击', async () => {
    let resolve!: (text: string) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const { visible, state } = createTranslation();
    const request = state.translate();
    const signal = vi.mocked(translateText).mock.calls[0][3]!;
    visible.value = false;
    expect(signal.aborted).toBe(true);
    resolve('女孩');
    await request;
    visible.value = true;
    expect(state.text.value).toBe('');
    expect(translateText).toHaveBeenCalledTimes(1);
  });

  it.each(['', ' \n ', '123, !!!'])('空文本或纯符号 %s 不可翻译', async source => {
    const { state } = createTranslation(source);
    expect(state.canTranslate.value).toBe(false);
    await state.translate();
    expect(translateText).not.toHaveBeenCalled();
  });

  it('弹窗隐藏时不可手动发起请求', async () => {
    const { state } = createTranslation('a girl', ref(false));
    await state.translate();
    expect(translateText).not.toHaveBeenCalled();
  });

  it('失败后保留原文并允许手动重试', async () => {
    vi.mocked(translateText).mockRejectedValueOnce(new Error('网络错误'));
    const { source, state } = createTranslation();
    await state.translate();
    expect(state.error.value).toBe('网络错误');
    expect(state.canTranslate.value).toBe(true);
    expect(source.value).toBe('a girl');
    await state.translate();
    expect(state.error.value).toBe('');
    expect(state.text.value).toBe('translated:a girl');
  });

  it('卸载后终止请求且不再接受新请求', async () => {
    let resolve!: (text: string) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const { state, scope } = createTranslation();
    const request = state.translate();
    const signal = vi.mocked(translateText).mock.calls[0][3]!;
    scope.stop();
    expect(signal.aborted).toBe(true);
    resolve('女孩');
    await request;
    await state.translate();
    expect(state.text.value).toBe('');
    expect(translateText).toHaveBeenCalledTimes(1);
  });
});
