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
  const onApply = vi.fn((translatedText: string) => {
    source.value = translatedText;
  });
  const state = scope.run(() => useManualTranslation(source, { visible, provider, onApply }))!;
  return { source, provider, visible, state, scope, onApply };
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

describe('useManualTranslation 编辑译文并回填', () => {
  it('编辑不会触发请求，点击后才翻译为英文并回填，保留草稿继续编辑', async () => {
    const { source, state, onApply } = createTranslation();
    await state.translate();
    state.text.value = '女孩，红色连衣裙';
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
    expect(source.value).toBe('a girl');

    vi.mocked(translateText).mockResolvedValueOnce('a girl, red dress');
    await state.translateAndApply();
    expect(translateText).toHaveBeenLastCalledWith('女孩，红色连衣裙', 'zh-en', 'google', expect.any(AbortSignal));
    expect(onApply).toHaveBeenCalledExactlyOnceWith('a girl, red dress');
    expect(source.value).toBe('a girl, red dress');
    expect(state.text.value).toBe('女孩，红色连衣裙');
    expect(state.translationTargetLabel.value).toBe('中文');
    expect(state.hasTranslation.value).toBe(true);
    expect(state.applied.value).toBe(true);

    state.text.value = '女孩，蓝色连衣裙';
    expect(state.applied.value).toBe(false);
    expect(source.value).toBe('a girl, red dress');
  });

  it('草稿是英文时回填仍固定译为英文，并沿用所选服务', async () => {
    const { provider, state, onApply } = createTranslation('一个女孩');
    provider.value = 'deepl';
    await state.translate();
    state.text.value = 'a girl, blue eyes';
    vi.mocked(translateText).mockResolvedValueOnce('a girl, blue eyes');
    await state.translateAndApply();
    expect(translateText).toHaveBeenLastCalledWith('a girl, blue eyes', 'zh-en', 'deepl', expect.any(AbortSignal));
    expect(onApply).toHaveBeenCalledExactlyOnceWith('a girl, blue eyes');
  });

  it('未获取译文时不可回填', async () => {
    const { state, onApply } = createTranslation();
    expect(state.canApply.value).toBe(false);
    await state.translateAndApply();
    expect(translateText).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('清空译文不会关闭编辑框，空白草稿不可回填', async () => {
    const { state, onApply } = createTranslation();
    await state.translate();
    state.text.value = ' \n ';
    expect(state.hasTranslation.value).toBe(true);
    expect(state.canApply.value).toBe(false);
    await state.translateAndApply();
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('回填翻译失败保留原文和草稿，并允许重试', async () => {
    const { source, state, onApply } = createTranslation();
    await state.translate();
    state.text.value = '女孩，微笑';
    vi.mocked(translateText).mockRejectedValueOnce(new Error('网络错误'));
    await state.translateAndApply();
    expect(source.value).toBe('a girl');
    expect(state.text.value).toBe('女孩，微笑');
    expect(state.error.value).toBe('网络错误');
    expect(state.canApply.value).toBe(true);
    expect(onApply).not.toHaveBeenCalled();

    vi.mocked(translateText).mockResolvedValueOnce('a girl, smile');
    await state.translateAndApply();
    expect(source.value).toBe('a girl, smile');
    expect(state.error.value).toBe('');
  });

  it('空翻译结果不能清空上方原文', async () => {
    const { source, state, onApply } = createTranslation();
    await state.translate();
    state.text.value = '女孩';
    vi.mocked(translateText).mockResolvedValueOnce(' \n ');
    await state.translateAndApply();
    expect(source.value).toBe('a girl');
    expect(state.text.value).toBe('女孩');
    expect(state.error.value).toContain('未返回英文译文');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('回填进行中禁止重复请求和普通翻译', async () => {
    const { state, onApply } = createTranslation();
    await state.translate();
    let resolve!: (text: string) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    const request = state.translateAndApply();
    expect(state.applying.value).toBe(true);
    expect(state.canTranslate.value).toBe(false);
    expect(state.canApply.value).toBe(false);
    await state.translateAndApply();
    await state.translate();
    expect(translateText).toHaveBeenCalledTimes(2);
    resolve('a girl, smile');
    await request;
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(state.applying.value).toBe(false);
  });

  it.each(['draft', 'source', 'provider', 'hide', 'unmount'] as const)(
    '%s 变化取消回填请求，晚到的结果不写入原文',
    async change => {
      const { source, provider, visible, state, scope, onApply } = createTranslation();
      await state.translate();
      state.text.value = '女孩，微笑';
      let resolve!: (text: string) => void;
      vi.mocked(translateText).mockImplementationOnce(
        () =>
          new Promise(done => {
            resolve = done;
          }),
      );
      const request = state.translateAndApply();
      const signal = vi.mocked(translateText).mock.calls.at(-1)![3]!;
      if (change === 'draft') state.text.value = '女孩，大笑';
      if (change === 'source') source.value = 'a boy';
      if (change === 'provider') provider.value = 'deepl';
      if (change === 'hide') visible.value = false;
      if (change === 'unmount') scope.stop();
      expect(signal.aborted).toBe(true);
      resolve('a girl, smile');
      await request;
      expect(onApply).not.toHaveBeenCalled();
      expect(source.value).toBe(change === 'source' ? 'a boy' : 'a girl');
      expect(state.applying.value).toBe(false);
    },
  );

  it('修改草稿重新回填后，旧请求的失败不会覆盖成功状态', async () => {
    const { source, state, onApply } = createTranslation();
    await state.translate();
    state.text.value = '女孩，微笑';
    let reject!: (reason: Error) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise((_done, fail) => {
          reject = fail;
        }),
    );
    const oldRequest = state.translateAndApply();
    state.text.value = '女孩，大笑';
    vi.mocked(translateText).mockResolvedValueOnce('a girl, laughing');
    await state.translateAndApply();
    reject(new Error('旧请求错误'));
    await oldRequest;
    expect(onApply).toHaveBeenCalledExactlyOnceWith('a girl, laughing');
    expect(source.value).toBe('a girl, laughing');
    expect(state.text.value).toBe('女孩，大笑');
    expect(state.error.value).toBe('');
    expect(state.applied.value).toBe(true);
  });
});
