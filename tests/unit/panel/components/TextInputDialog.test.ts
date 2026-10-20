import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Button from 'primevue/button';
import Select from 'primevue/select';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createImagePromptPreset } from '@/constants/image-prompt';
import TextInputDialog from '@/panel/components/TextInputDialog.vue';
import TranslationPanel from '@/panel/components/TranslationPanel.vue';
import { useSettingsStore } from '@/store/settings';

vi.mock('@/services/translation/text-translation', () => ({
  translateText: vi.fn(async (text: string) => `translated:${text}`),
}));

import { translateText } from '@/services/translation/text-translation';

enableAutoUnmount(afterEach);

/**
 * 挂载文本输入弹窗组件
 * @param props 覆盖属性
 * @returns 挂载后的包装器
 */
function mountDialog(props: Record<string, any> = {}) {
  return mount(TextInputDialog, {
    props: {
      visible: true,
      value: 'template one, pristine pos',
      secondaryValue: 'pristine neg, no bad stuff',
      positivePresetId: 'P1',
      negativePresetId: 'N1',
      positiveCore: 'pristine pos',
      negativeCore: 'pristine neg',
      title: '编辑提示词后生图',
      message: '测试弹窗',
      primaryLabel: '正面提示词',
      secondaryLabel: '负面提示词',
      enablePresetSelector: true,
      ...props,
    },
    attachTo: document.body,
    global: {
      plugins: [PrimeVue],
    },
  });
}

describe('TextInputDialog 弹窗预设切换与整体文本联动', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const { settings } = useSettingsStore();
    settings.imagePromptPresets.positive = [
      createImagePromptPreset('P1', 'P1', 'template one, '),
      createImagePromptPreset('P2', 'P2', 'template two, '),
    ];
    settings.imagePromptPresets.negative = [
      { id: 'N1', name: 'N1', text: ', no bad stuff', placeholderOffset: 0 },
      { id: 'N2', name: 'N2', text: ', other bad stuff', placeholderOffset: 0 },
    ];
  });

  it('切换正面预设下拉后正面 Textarea 值变为「新模板 + pristine core」', async () => {
    const wrapper = mountDialog();
    await nextTick();

    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(textareas.length).toBeGreaterThanOrEqual(2);
    expect(textareas[0].value).toBe('template one, pristine pos');

    await wrapper.setProps({ positivePresetId: 'P2' });
    await nextTick();

    expect(textareas[0].value).toBe('template two, pristine pos');
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['template two, pristine pos']);
  });

  it('正面预设切回原样变回裸 core', async () => {
    const wrapper = mountDialog();
    await nextTick();

    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');

    await wrapper.setProps({ positivePresetId: '' });
    await nextTick();

    expect(textareas[0].value).toBe('pristine pos');
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['pristine pos']);
  });

  it('负面侧对称：切换负面预设变为新模板+pristine，切回原样变回裸 core', async () => {
    const wrapper = mountDialog();
    await nextTick();

    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(textareas.length).toBeGreaterThanOrEqual(2);
    expect(textareas[1].value).toBe('pristine neg, no bad stuff');

    await wrapper.setProps({ negativePresetId: 'N2' });
    await nextTick();

    expect(textareas[1].value).toBe('pristine neg, other bad stuff');
    expect(wrapper.emitted('update:secondaryValue')?.at(-1)).toEqual(['pristine neg, other bad stuff']);

    await wrapper.setProps({ negativePresetId: '' });
    await nextTick();

    expect(textareas[1].value).toBe('pristine neg');
    expect(wrapper.emitted('update:secondaryValue')?.at(-1)).toEqual(['pristine neg']);
  });

  it('单字段流程（无预设选择器）下预设 id 重置为空不清空已回填的 value', async () => {
    const wrapper = mountDialog({
      enablePresetSelector: false,
      positivePresetId: 'P1',
      positiveCore: '',
      value: '上次追加要求',
    });
    await nextTick();

    const textareas = document.querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(textareas[0].value).toBe('上次追加要求');

    // 父组件重置弹窗 state，positivePresetId 从 'P1' 变为 ''
    await wrapper.setProps({ positivePresetId: '' });
    await nextTick();

    expect(textareas[0].value).toBe('上次追加要求');
  });

  it('positivePresetId 为有效预设 ID 时正面下拉选项列表不含「原提示词」项', async () => {
    const wrapper = mountDialog({ positivePresetId: 'P1' });
    await nextTick();

    const selects = wrapper.findAllComponents(Select);
    const positiveSelect = selects[0];
    const options = positiveSelect.props('options') as Array<{ id: string; name: string }>;

    expect(options.some(opt => opt.name === '原提示词')).toBe(false);
    expect(options).toEqual([
      { id: 'P1', name: 'P1' },
      { id: 'P2', name: 'P2' },
    ]);
  });

  it('positivePresetId 为空串时正面下拉选项列表包含「原提示词」且在首位', async () => {
    const wrapper = mountDialog({ positivePresetId: '' });
    await nextTick();

    const selects = wrapper.findAllComponents(Select);
    const positiveSelect = selects[0];
    const options = positiveSelect.props('options') as Array<{ id: string; name: string }>;

    expect(options[0]).toEqual({ id: '', name: '原提示词' });
    expect(options).toEqual([
      { id: '', name: '原提示词' },
      { id: 'P1', name: 'P1' },
      { id: 'P2', name: 'P2' },
    ]);
  });

  it('positivePresetId 为失效 ID（如 P404）时选项列表同时包含「原提示词」（首位）与失效项（尾位）', async () => {
    const wrapper = mountDialog({ positivePresetId: 'P404' });
    await nextTick();

    const selects = wrapper.findAllComponents(Select);
    const positiveSelect = selects[0];
    const options = positiveSelect.props('options') as Array<{ id: string; name: string }>;

    expect(options[0]).toEqual({ id: '', name: '原提示词' });
    expect(options.at(-1)).toEqual({ id: 'P404', name: 'P404 (已失效)' });
    expect(options).toEqual([
      { id: '', name: '原提示词' },
      { id: 'P1', name: 'P1' },
      { id: 'P2', name: 'P2' },
      { id: 'P404', name: 'P404 (已失效)' },
    ]);
  });

  it('LoRA 预设组：loraPresetId 命中有效预设时选项列表不含「原图 LoRA」，为空串时包含「原图 LoRA」', async () => {
    const { settings } = useSettingsStore();
    settings.comfyui.loraPresets.presets = [{ id: 'L1', name: 'LoRA Group 1' } as any];

    const wrapper = mountDialog({
      enableLoraSelector: true,
      loraPresetId: 'L1',
    });
    await nextTick();

    const selects = wrapper.findAllComponents(Select);
    // 当 enableLoraSelector 为 true 时，首个 Select 即为 LoRA 下拉框
    const loraSelect = selects[0];
    const optionsHit = loraSelect.props('options') as Array<{ id: string; name: string }>;

    expect(optionsHit.some(opt => opt.name === '原图 LoRA')).toBe(false);
    expect(optionsHit).toEqual([{ id: 'L1', name: 'LoRA Group 1' }]);

    await wrapper.setProps({ loraPresetId: '' });
    await nextTick();

    const optionsEmpty = loraSelect.props('options') as Array<{ id: string; name: string }>;
    expect(optionsEmpty[0]).toEqual({ id: '', name: '原图 LoRA' });
    expect(optionsEmpty).toEqual([
      { id: '', name: '原图 LoRA' },
      { id: 'L1', name: 'LoRA Group 1' },
    ]);
  });
});

describe('TextInputDialog 手动翻译', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(translateText).mockReset();
    vi.mocked(translateText).mockImplementation(async text => 'translated:' + text);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('打开与修改输入都不自动翻译，点击后在输入框下方显示译文', async () => {
    vi.useFakeTimers();
    const wrapper = mountDialog({ secondaryValue: '' });
    await nextTick();
    await vi.advanceTimersByTimeAsync(2000);
    expect(translateText).not.toHaveBeenCalled();

    await wrapper.setProps({ value: 'a smiling girl' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(translateText).not.toHaveBeenCalled();
    vi.useRealTimers();

    const panel = wrapper.findAllComponents(TranslationPanel)[0];
    await panel.findComponent(Button).trigger('click');
    await flushPromises();

    expect(translateText).toHaveBeenCalledWith('a smiling girl', 'en-zh', 'google', expect.any(AbortSignal));
    expect(panel.text()).toContain('译文 · 中文');
    expect(panel.get('textarea').element.value).toBe('translated:a smiling girl');
    const textarea = document.querySelector('textarea')!;
    expect(textarea.compareDocumentPosition(panel.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(textarea.value).toBe('a smiling girl');
    expect(wrapper.emitted('update:value')).toBeUndefined();
  });

  it('中文输入点击后显示英文译文，修改后等待下一次点击', async () => {
    const wrapper = mountDialog({
      enablePresetSelector: false,
      value: '一个女孩',
      secondaryLabel: '',
      secondaryValue: '',
    });
    await nextTick();
    const panel = wrapper.findComponent(TranslationPanel);
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    expect(panel.text()).toContain('译文 · 英文');
    expect(panel.get('textarea').element.value).toBe('translated:一个女孩');

    await wrapper.setProps({ value: '一个女孩，微笑' });
    expect(panel.find('textarea').exists()).toBe(false);
    expect(translateText).toHaveBeenCalledTimes(1);
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    expect(translateText).toHaveBeenLastCalledWith('一个女孩，微笑', 'zh-en', 'google', expect.any(AbortSignal));
    expect(panel.get('textarea').element.value).toBe('translated:一个女孩，微笑');
  });

  it('正负面分别手动翻译，确认提交仍使用原文', async () => {
    const wrapper = mountDialog({ value: '一个女孩，微笑' });
    await nextTick();
    const panels = wrapper.findAllComponents(TranslationPanel);
    await panels[0].findComponent(Button).trigger('click');
    await flushPromises();
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(panels[1].find('textarea').exists()).toBe(false);
    await panels[1].findComponent(Button).trigger('click');
    await flushPromises();
    expect(panels[1].get('textarea').element.value).toBe('translated:pristine neg, no bad stuff');
    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('update:secondaryValue')).toBeUndefined();

    const submit = wrapper.findAllComponents(Button).find(button => button.props('label') === '确定')!;
    await submit.trigger('click');
    expect(wrapper.emitted('submit')?.at(-1)).toEqual([
      expect.objectContaining({
        value: '一个女孩，微笑',
        secondaryValue: 'pristine neg, no bad stuff',
      }),
    ]);
  });

  it('切换到 DeepL 后仅在点击时请求，并记住服务选择', async () => {
    const wrapper = mountDialog();
    await nextTick();
    const panels = wrapper.findAllComponents(TranslationPanel);
    panels[0].findComponent(Select).vm.$emit('update:modelValue', 'deepl');
    await nextTick();
    await flushPromises();
    expect(translateText).not.toHaveBeenCalled();
    expect(panels[1].findComponent(Select).props('modelValue')).toBe('deepl');
    expect(panels[0].text()).toContain('DeepL 密钥');
    await panels[0].findComponent(Button).trigger('click');
    await flushPromises();
    expect(translateText).toHaveBeenLastCalledWith(
      'template one, pristine pos',
      'en-zh',
      'deepl',
      expect.any(AbortSignal),
    );
    expect(localStorage.getItem('cosmos-vision:translation-provider')).toBe('deepl');
    wrapper.unmount();

    const reopened = mountDialog();
    await nextTick();
    expect(reopened.findComponent(TranslationPanel).findComponent(Select).props('modelValue')).toBe('deepl');
    expect(translateText).toHaveBeenCalledTimes(1);
  });

  it('翻译失败展示原因并支持重试，译文按纯文本显示', async () => {
    vi.mocked(translateText).mockRejectedValueOnce(new Error('服务不可用'));
    const wrapper = mountDialog();
    await nextTick();
    const panel = wrapper.findComponent(TranslationPanel);
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    expect(panel.text()).toContain('翻译失败：服务不可用');
    expect((panel.findComponent(Button).element as HTMLButtonElement).disabled).toBe(false);

    vi.mocked(translateText).mockResolvedValueOnce('<img src=x onerror=alert(1)>');
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    expect(panel.get('textarea').element.value).toBe('<img src=x onerror=alert(1)>');
    expect(panel.find('img').exists()).toBe(false);
    expect(wrapper.emitted('update:value')).toBeUndefined();
  });

  it('空输入禁用翻译按钮，隐藏的负面字段没有翻译入口', async () => {
    const wrapper = mountDialog({ value: '', secondaryLabel: '' });
    await nextTick();
    const panels = wrapper.findAllComponents(TranslationPanel);
    expect(panels).toHaveLength(1);
    expect((panels[0].findComponent(Button).element as HTMLButtonElement).disabled).toBe(true);
    expect(translateText).not.toHaveBeenCalled();
  });
});

describe('TextInputDialog 编辑译文后写入英文提示词', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(translateText).mockReset();
    vi.mocked(translateText).mockResolvedValue('一个女孩');
  });

  it.each([
    [0, 'update:value', 'update:secondaryValue', 'value', 'secondaryValue'],
    [1, 'update:secondaryValue', 'update:value', 'secondaryValue', 'value'],
  ] as const)(
    '第 %i 个译文编辑后只回填对应字段，确认提交使用英文结果',
    async (index, updateEvent, untouchedEvent, field, untouchedField) => {
      const wrapper = mountDialog();
      await nextTick();
      const originalOther = wrapper.props(untouchedField);
      const panel = wrapper.findAllComponents(TranslationPanel)[index];
      await panel.findComponent(Button).trigger('click');
      await flushPromises();
      const editor = panel.get('textarea');
      await editor.setValue('一个女孩，穿着红色连衣裙');
      expect(wrapper.emitted(updateEvent)).toBeUndefined();
      expect(wrapper.emitted(untouchedEvent)).toBeUndefined();
      expect(translateText).toHaveBeenCalledTimes(1);

      vi.mocked(translateText).mockResolvedValueOnce('a girl, wearing a red dress');
      await panel.get('[aria-label="翻译为英文并写入上方"]').trigger('click');
      await flushPromises();
      expect(translateText).toHaveBeenLastCalledWith(
        '一个女孩，穿着红色连衣裙',
        'zh-en',
        'google',
        expect.any(AbortSignal),
      );
      expect(wrapper.emitted(updateEvent)?.at(-1)).toEqual(['a girl, wearing a red dress']);
      expect(wrapper.emitted(untouchedEvent)).toBeUndefined();
      expect(panel.get('textarea').element.value).toBe('一个女孩，穿着红色连衣裙');
      expect(panel.text()).toContain('已写入上方提示词');
      expect(panel.text()).toContain('译文 · 中文');

      const promptInput = panel.element.previousElementSibling!.querySelector('textarea')!;
      expect(promptInput.value).toBe('a girl, wearing a red dress');
      const submit = wrapper.findAllComponents(Button).find(button => button.props('label') === '确定')!;
      await submit.trigger('click');
      expect(wrapper.emitted('submit')?.at(-1)).toEqual([
        expect.objectContaining({
          [field]: 'a girl, wearing a red dress',
          [untouchedField]: originalOther,
        }),
      ]);
    },
  );

  it('草稿清空后编辑框仍存在且回填按钮禁用', async () => {
    const wrapper = mountDialog();
    await nextTick();
    const panel = wrapper.findComponent(TranslationPanel);
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    await panel.get('textarea').setValue('');
    expect(panel.find('textarea').exists()).toBe(true);
    expect((panel.get('[aria-label="翻译为英文并写入上方"]').element as HTMLButtonElement).disabled).toBe(true);
    await panel.get('textarea').setValue('一个女孩，微笑');
    expect((panel.get('[aria-label="翻译为英文并写入上方"]').element as HTMLButtonElement).disabled).toBe(false);
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('update:value')).toBeUndefined();
  });

  it('回填失败后草稿仍可见可编辑，再次点击可重试', async () => {
    const wrapper = mountDialog();
    await nextTick();
    const panel = wrapper.findComponent(TranslationPanel);
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    await panel.get('textarea').setValue('一个女孩，微笑');
    vi.mocked(translateText).mockRejectedValueOnce(new Error('翻译超时'));
    await panel.get('[aria-label="翻译为英文并写入上方"]').trigger('click');
    await flushPromises();
    expect(panel.text()).toContain('翻译失败：翻译超时');
    expect(panel.get('textarea').element.value).toBe('一个女孩，微笑');
    expect(wrapper.emitted('update:value')).toBeUndefined();

    await panel.get('textarea').setValue('一个女孩，大笑');
    vi.mocked(translateText).mockResolvedValueOnce('a girl, laughing');
    await panel.get('[aria-label="翻译为英文并写入上方"]').trigger('click');
    await flushPromises();
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['a girl, laughing']);
  });

  it('回填等待期间修改上方提示词，旧请求不会覆盖新内容', async () => {
    const wrapper = mountDialog();
    await nextTick();
    const panel = wrapper.findComponent(TranslationPanel);
    await panel.findComponent(Button).trigger('click');
    await flushPromises();
    let resolve!: (text: string) => void;
    vi.mocked(translateText).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        }),
    );
    await panel.get('[aria-label="翻译为英文并写入上方"]').trigger('click');
    const signal = vi.mocked(translateText).mock.calls.at(-1)![3]!;
    await wrapper.setProps({ value: 'a boy' });
    expect(signal.aborted).toBe(true);
    resolve('a girl, smiling');
    await flushPromises();
    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(document.querySelector('textarea')!.value).toBe('a boy');
  });
});
