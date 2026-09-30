<template>
  <div
    class="flex flex-col gap-(--cv-space-sm) pt-(--cv-space-lg)"
    data-cv-tutorial="comfyui-lora-node-binding"
  >
    <div class="flex items-center gap-(--cv-space-md)">
      <span class="shrink-0 text-(length:--cv-font-size-xs) font-semibold text-(--cv-on-surface)">本节点 LoRA 组</span>
      <Select
        :model-value="selectedValue"
        :options="options"
        option-label="label"
        option-value="value"
        size="small"
        fluid
        class="min-w-0 flex-1"
        aria-label="本节点使用的 LoRA 组"
        @update:model-value="onValueChange"
      />
    </div>
    <div
      class="text-(length:--cv-font-size-xs) leading-[1.5]"
      :class="isBindingMissing ? 'text-(--cvp-orange-500)' : 'text-(--cv-on-surface-variant)'"
    >
      {{ hintText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ComfyUILoraNodeBinding } from '@/services/comfyui/types';

/** 选择器取值：跟随激活组 / 不注入 / 具体 LoRA 组 ID */
type BindingOptionValue = 'active' | 'off' | string;

const props = defineProps<{
  /** 节点已保存的绑定；null 表示未显式设置，按 defaultMode 处理 */
  modelValue: ComfyUILoraNodeBinding | null;
  /** 未设置绑定时该节点的实际行为：首个 LoRA 节点跟随激活组，其余不注入 */
  defaultMode: 'active' | 'off';
  /** 可选 LoRA 组 */
  presets: readonly { id: string; name: string }[];
  /** 当前激活组名（用于「跟随当前激活组」文案） */
  activePresetName: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [binding: ComfyUILoraNodeBinding | null];
}>();

/** 绑定的 LoRA 组已被删除时其 ID（用于补一个失效提示项，避免下拉空白） */
const missingPresetId = computed(() => {
  if (props.modelValue?.mode !== 'fixed') return '';
  const { presetId } = props.modelValue;
  return props.presets.some(preset => preset.id === presetId) ? '' : presetId;
});

const isBindingMissing = computed(() => Boolean(missingPresetId.value));

/** 下拉当前值：固定绑定取组 ID，其余取绑定模式或该节点的默认行为 */
const selectedValue = computed<BindingOptionValue>(() => {
  if (props.modelValue?.mode === 'fixed') return props.modelValue.presetId;
  return props.modelValue?.mode ?? props.defaultMode;
});

/** 下拉选项：跟随激活组 / 失效组（如有）/ 各 LoRA 组 / 不注入 */
const options = computed(() => {
  const items = [
    { value: 'active' as BindingOptionValue, label: `跟随当前激活组（${props.activePresetName || '未命名'}）` },
    ...props.presets.map(preset => ({
      value: preset.id as BindingOptionValue,
      label: preset.name?.trim() || '未命名',
    })),
    { value: 'off' as BindingOptionValue, label: '不注入（保留工作流原样）' },
  ];
  if (isBindingMissing.value) {
    items.splice(1, 0, { value: missingPresetId.value, label: '已失效的 LoRA 组' });
  }
  return items;
});

/** 当前选项的说明文案 */
const hintText = computed(() => {
  if (isBindingMissing.value) return '绑定的 LoRA 组已删除，生图时回退到当前激活组';
  const value = selectedValue.value;
  if (value === 'off') return '生图时保持工作流内嵌 LoRA，可在下方直接编辑该节点的 loras / text';
  if (value === 'active') return '生图时写入当前激活的 LoRA 组，会随面板切换而改变';
  return '生图时固定写入该 LoRA 组，不随面板切换改变';
});

/**
 * 转换下拉选择为节点绑定
 * 与默认行为一致时写回 null，保持工作流 JSON 不留冗余字段
 * @param value 下拉取值
 */
function onValueChange(value: unknown): void {
  const next = String(value ?? '') as BindingOptionValue;
  if (next === 'active' || next === 'off') {
    emit('update:modelValue', next === props.defaultMode ? null : { mode: next });
    return;
  }
  if (!next) return;
  emit('update:modelValue', { mode: 'fixed', presetId: next });
}
</script>
