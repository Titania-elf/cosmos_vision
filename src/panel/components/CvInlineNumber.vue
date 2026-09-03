<template>
  <!--
    极简数字编辑：默认显示纯文本（点击进入编辑），编辑态显示 InputNumber。
    v-bind="$attrs" 透传 aria-label 等；值与编辑通过 update:model-value 提交。
  -->
  <InputNumber
    v-if="editing"
    ref="inputRef"
    :model-value="modelValue"
    :min="min"
    :max="max"
    :step="step"
    :min-fraction-digits="minFractionDigits"
    :max-fraction-digits="maxFractionDigits"
    :use-grouping="false"
    fluid
    class="cv-inline-number w-(--cv-inline-number-width,5.75rem) min-w-0"
    :pt="inlineNumberPt"
    v-bind="$attrs"
    @update:model-value="onInput"
    @blur="commit"
    @keydown.escape.prevent="cancel"
    @keydown.enter.prevent="commit"
  />
  <button
    v-else
    type="button"
    class="cv-inline-number-text shrink-0 cursor-pointer border-0 bg-transparent p-0 text-right font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant) tabular-nums transition-colors duration-150 hover:text-(--cvp-primary-color)"
    :aria-label="`${modelValue}，点击编辑`"
    :title="`${modelValue}（点击编辑）`"
    v-bind="$attrs"
    @click="editing = true"
  >
    {{ formatted }}
  </button>
</template>

<script setup lang="ts">
import type { InputNumberPassThroughOptions } from 'primevue/inputnumber';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    step?: number;
    minFractionDigits?: number;
    maxFractionDigits?: number;
  }>(),
  { min: -Infinity, max: Infinity, step: 1, minFractionDigits: 0, maxFractionDigits: 3 },
);

const emit = defineEmits<{
  'update:model-value': [value: number];
}>();

const editing = ref(false);
const inputRef = ref<{ $el?: HTMLElement } | null>(null);
/** 编辑过程中的临时值；失焦提交 */
let draft: number | null = null;

/** 文本态展示：去除多余的尾随零（1.000 → 1，0.700 → 0.7） */
const formatted = computed(() => {
  const rounded = Number(props.modelValue.toFixed(props.maxFractionDigits));
  return rounded.toString();
});

/** InputNumber：内嵌 input 全宽无框（编辑态） */
const inlineNumberPt: InputNumberPassThroughOptions = {
  pcInputText: { root: { class: 'cv-prime-field w-full text-center' } },
};

watch(editing, async opened => {
  if (!opened) return;
  draft = null;
  await nextTick();
  focusInput();
});

/**
 * 聚焦编辑输入框并全选，便于直接键入覆盖
 */
function focusInput(): void {
  const el = inputRef.value?.$el;
  const input = el instanceof HTMLInputElement ? el : el?.querySelector('input');
  input?.focus();
  input?.select();
}

/**
 * 记录编辑中的值
 * @param value 输入值
 */
function onInput(value: number | null): void {
  draft = value;
}

/**
 * 提交编辑（有效临时值才覆写）
 */
function commit(): void {
  if (draft !== null && Number.isFinite(draft)) {
    emit('update:model-value', clamp(draft));
  }
  draft = null;
  editing.value = false;
}

/**
 * 取消编辑（Escape），丢弃临时值
 */
function cancel(): void {
  draft = null;
  editing.value = false;
}

/**
 * 夹到合法范围
 * @param value 输入值
 * @returns 合法值
 */
function clamp(value: number): number {
  return Math.min(props.max, Math.max(props.min, value));
}
</script>
