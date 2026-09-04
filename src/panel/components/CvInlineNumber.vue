<template>
  <!--
    极简数字编辑：默认显示纯文本（点击进入编辑），编辑态显示 InputNumber。
    v-bind="$attrs" 透传 aria-label 等；值与编辑通过 update:model-value 提交。
    提交时机：点击组件外任意位置（含空白处）/ 回车 / 失焦 / 输入停顿均提交。
    iOS 虚拟键盘无回车键且点按非聚焦区不触发失焦，因此以 document 级
    pointerdown 捕获作为移动端主提交路径。
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
    enterkeyhint="done"
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
/** 编辑过程中的临时值；失焦或回车提交 */
let draft: number | null = null;
/** 进入编辑时的原值；Escape 取消时恢复（停顿提交可能已覆写中途值） */
let original: number | null = null;
/** 输入停顿自动提交的定时器 */
let idleCommitTimer: number | null = null;
/** 输入停顿即提交的等待时长（毫秒） */
const IDLE_COMMIT_DELAY = 600;

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
  if (opened) {
    draft = null;
    original = props.modelValue;
    // 捕获阶段监听全局 pointerdown：点空白处（不触发失焦的场景）也能提交
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    await nextTick();
    focusInput();
    return;
  }
  detachOutsidePointerDown();
});

onBeforeUnmount(() => {
  clearIdleCommitTimer();
  detachOutsidePointerDown();
});

/**
 * 聚焦编辑输入框并全选，便于直接键入覆盖
 */
function focusInput(): void {
  const input = findInputElement();
  input?.focus();
  input?.select();
}

/**
 * 定位 InputNumber 内部的原生 input 元素
 * @returns 原生 input 或 null
 */
function findInputElement(): HTMLInputElement | null {
  const el = inputRef.value?.$el;
  return el instanceof HTMLInputElement ? el : (el?.querySelector('input') ?? null);
}

/**
 * 全局 pointerdown：点击输入框以外的任意位置立即提交
 * @param event 指针事件
 */
function handleOutsidePointerDown(event: PointerEvent): void {
  const input = findInputElement();
  if (input?.contains(event.target as Node)) return;
  commit();
}

/**
 * 移除全局 pointerdown 监听
 */
function detachOutsidePointerDown(): void {
  document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
}

/**
 * 记录编辑中的值，并在输入停顿后自动提交
 * @param value 输入值
 */
function onInput(value: number | null): void {
  draft = value;
  scheduleIdleCommit();
}

/**
 * 安排输入停顿后的自动提交
 */
function scheduleIdleCommit(): void {
  clearIdleCommitTimer();
  idleCommitTimer = window.setTimeout(() => {
    idleCommitTimer = null;
    if (editing.value && draft !== null && Number.isFinite(draft)) {
      emit('update:model-value', clamp(draft));
    }
  }, IDLE_COMMIT_DELAY);
}

/**
 * 清除待执行的自动提交
 */
function clearIdleCommitTimer(): void {
  if (idleCommitTimer === null) return;
  clearTimeout(idleCommitTimer);
  idleCommitTimer = null;
}

/**
 * 提交编辑（有效值才覆写）
 * 组件未收到输入事件时（部分虚拟键盘），兜底直接解析输入框文本
 */
function commit(): void {
  clearIdleCommitTimer();
  const value = draft ?? readRawInputValue();
  if (value !== null && Number.isFinite(value)) {
    emit('update:model-value', clamp(value));
  }
  draft = null;
  original = null;
  editing.value = false;
}

/**
 * 直接读取原生输入框文本并解析为数值
 * @returns 数值或 null（空/非法文本）
 */
function readRawInputValue(): number | null {
  const text = findInputElement()?.value.trim() ?? '';
  if (!text) return null;
  const parsed = Number(text.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 取消编辑（Escape），丢弃临时值；停顿提交已覆写时恢复原值
 */
function cancel(): void {
  clearIdleCommitTimer();
  if (original !== null && props.modelValue !== original) {
    emit('update:model-value', original);
  }
  draft = null;
  original = null;
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
