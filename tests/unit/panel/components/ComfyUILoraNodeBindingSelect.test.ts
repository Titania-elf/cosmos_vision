import { mount } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { describe, expect, it } from 'vitest';
import ComfyUILoraNodeBindingSelect from '@/panel/components/comfyui/ComfyUILoraNodeBindingSelect.vue';

const PRESETS = [
  { id: 'p-active', name: '角色A' },
  { id: 'p-detail', name: '细节增强' },
];

/**
 * 挂载节点 LoRA 组绑定下拉
 * @param props 覆盖属性
 * @returns 挂载后的包装器
 */
function mountSelect(props: Record<string, unknown> = {}) {
  return mount(ComfyUILoraNodeBindingSelect, {
    props: {
      modelValue: null,
      defaultMode: 'active',
      presets: PRESETS,
      activePresetName: '角色A',
      ...props,
    },
    attachTo: document.body,
    global: { plugins: [PrimeVue] },
  });
}

/**
 * 读取最后一次 update:modelValue 载荷
 * @param wrapper 包装器
 * @returns 载荷
 */
function lastEmitted(wrapper: ReturnType<typeof mountSelect>): unknown {
  const events = wrapper.emitted('update:modelValue');
  return events?.[events.length - 1]?.[0];
}

describe('ComfyUILoraNodeBindingSelect', () => {
  it('未设置绑定的首个节点显示为跟随当前激活组', () => {
    const wrapper = mountSelect();

    expect(wrapper.text()).toContain('本节点 LoRA 组');
    expect(wrapper.text()).toContain('跟随当前激活组（角色A）');
  });

  it('未绑定的非首个节点按不注入展示', () => {
    const wrapper = mountSelect({ defaultMode: 'off' });

    expect(wrapper.text()).toContain('不注入（保留工作流原样）');
    expect(wrapper.text()).toContain('保持工作流内嵌 LoRA');  });

  it('选择具体 LoRA 组时发出固定绑定', async () => {
    const wrapper = mountSelect();
    const select = wrapper.findComponent({ name: 'Select' });

    select.vm.$emit('update:modelValue', 'p-detail');
    await wrapper.vm.$nextTick();

    expect(lastEmitted(wrapper)).toEqual({ mode: 'fixed', presetId: 'p-detail' });
  });

  it('选择与默认行为相同的模式时清除绑定，避免工作流留下冗余字段', async () => {
    const wrapper = mountSelect({ modelValue: { mode: 'fixed', presetId: 'p-detail' }, defaultMode: 'active' });
    const select = wrapper.findComponent({ name: 'Select' });

    select.vm.$emit('update:modelValue', 'active');
    await wrapper.vm.$nextTick();

    expect(lastEmitted(wrapper)).toBeNull();
  });

  it('非首个节点选择不注入时清除绑定', async () => {
    const wrapper = mountSelect({ modelValue: { mode: 'active' }, defaultMode: 'off' });
    const select = wrapper.findComponent({ name: 'Select' });

    select.vm.$emit('update:modelValue', 'off');
    await wrapper.vm.$nextTick();

    expect(lastEmitted(wrapper)).toBeNull();
  });

  it('绑定的组已删除时给出失效提示并说明回退行为', () => {
    const wrapper = mountSelect({ modelValue: { mode: 'fixed', presetId: 'p-deleted' } });

    expect(wrapper.text()).toContain('已失效的 LoRA 组');
    expect(wrapper.text()).toContain('回退到当前激活组');
  });
});
