<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissable-mask
    :draggable="false"
    header="批量添加 LoRA"
    :style="DIALOG_STYLE"
    :content-style="{ overflow: 'hidden' }"
  >
    <div class="flex flex-col gap-(--cv-space-3xl)">
      <!-- 搜索 + 全选 -->
      <div class="flex items-center gap-(--cv-space-md)">
        <InputText
          v-model="searchKeyword"
          placeholder="搜索 LoRA 名称..."
          class="min-w-0 flex-1"
          aria-label="搜索 LoRA"
        />
        <Button
          :label="isAllFilteredSelected ? '全不选' : '全选'"
          severity="secondary"
          variant="text"
          size="small"
          class="shrink-0"
          aria-label="切换全选"
          @click="toggleSelectAll"
        />
      </div>

      <!-- 候选列表 -->
      <div
        class="custom-scrollbar flex max-h-[min(50vh,24rem)] min-h-[9rem] flex-col gap-(--cv-space-xs) overflow-y-auto overscroll-contain"
      >
        <label
          v-for="option in filteredOptions"
          :key="option.value"
          class="flex cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) px-(--cv-space-lg) py-(--cv-space-xs) transition-colors duration-150"
          :class="option.added ? 'pointer-events-none opacity-45' : 'hover:bg-(--cv-surface-container-highest)'"
        >
          <input
            type="checkbox"
            class="sr-only"
            :checked="selectedIds.has(option.value)"
            :disabled="option.added"
            @change="toggleOption(option.value)"
          />
          <span class="flex size-4 shrink-0 items-center justify-center rounded-(--cv-space-3xs)" :class="option.added || selectedIds.has(option.value) ? 'bg-(--cvp-primary-color)' : 'border-(length:--cv-border-width) border-solid border-(--cv-outline-variant)'">
            <i v-if="option.added || selectedIds.has(option.value)" class="fa-solid fa-check text-(length:--cv-font-size-xs) text-(--cvp-primary-contrast-color)" aria-hidden="true" />
          </span>
          <span
            class="min-w-0 flex-1 overflow-hidden font-mono text-(length:--cv-font-size-xs) text-ellipsis whitespace-nowrap"
            :class="option.added ? 'text-(--cv-on-surface-variant)' : 'text-(--cv-on-surface)'"
            :title="option.value"
          >
            {{ option.value }}
          </span>
          <span v-if="option.added" class="shrink-0 text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            已添加
          </span>
        </label>
        <div
          v-if="!filteredOptions.length"
          class="flex min-h-[9rem] items-center justify-center text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
        >
          {{ searchKeyword ? '没有匹配的 LoRA' : '没有可添加的 LoRA，请先刷新 LoRA 库' }}
        </div>
      </div>

      <div class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
        已选 {{ selectedCount }} 个；添加后默认为禁用状态，启用请在列表中逐个打开
      </div>
    </div>
    <template #footer>
      <div class="cv-confirm-actions">
        <Button label="取消" text @click="visible = false" />
        <Button label="添加" icon="fa-solid fa-plus" :disabled="!selectedCount" @click="confirm" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import type { ComfyUILoraSetting } from '@/constants/comfyui';

/** 弹窗尺寸 */
const DIALOG_STYLE = {
  width: '26rem',
  maxWidth: 'calc(100vw - 2rem)',
} as const;

const visible = defineModel<boolean>('visible', { required: true });

const props = defineProps<{
  /** 拉取到的 LoRA 名称选项 */
  options: { value: string; label: string }[];
  /** 当前预设组已有的 LoRA 条目（判定已添加） */
  existingLoras: ComfyUILoraSetting[];
}>();

const emit = defineEmits<{
  /** 确认添加选中的 LoRA 名称列表 */
  confirm: [names: string[]];
}>();

const searchKeyword = ref('');
const selectedIds = ref<ReadonlySet<string>>(new Set());

/** 已在当前组中的 LoRA 名称集合 */
const addedNames = computed(() => new Set(props.existingLoras.map(lora => lora.name.trim()).filter(Boolean)));

/** 按关键词过滤后的候选选项（已添加排前并标记） */
const filteredOptions = computed(() => {
  const keyword = searchKeyword.value.trim().toLowerCase();
  return props.options
    .filter(option => option.value && (!keyword || option.value.toLowerCase().includes(keyword)))
    .map(option => ({ value: option.value, label: option.label, added: addedNames.value.has(option.value) }))
    .sort((left, right) => Number(left.added) - Number(right.added));
});

/** 过滤后可选项是否已全部选中 */
const isAllFilteredSelected = computed(() => {
  const selectable = filteredOptions.value.filter(option => !option.added);
  return selectable.length > 0 && selectable.every(option => selectedIds.value.has(option.value));
});

const selectedCount = computed(() => {
  const selectable = new Set(filteredOptions.value.filter(option => !option.added).map(option => option.value));
  let count = 0;
  for (const id of selectedIds.value) if (selectable.has(id)) count += 1;
  return count;
});

/**
 * 切换单个选项勾选状态
 * @param value 选项值
 */
function toggleOption(value: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  selectedIds.value = next;
}

/**
 * 切换过滤结果的全选状态
 */
function toggleSelectAll(): void {
  const selectable = filteredOptions.value.filter(option => !option.added).map(option => option.value);
  const next = new Set(selectedIds.value);
  const allSelected = selectable.length > 0 && selectable.every(value => next.has(value));
  if (allSelected) selectable.forEach(value => next.delete(value));
  else selectable.forEach(value => next.add(value));
  selectedIds.value = next;
}

/**
 * 确认添加：提交勾选且未添加的名称，并复位弹窗状态
 */
function confirm(): void {
  const selectable = new Set(filteredOptions.value.filter(option => !option.added).map(option => option.value));
  const names: string[] = [];
  for (const id of selectedIds.value) if (selectable.has(id)) names.push(id);
  if (!names.length) return;
  emit('confirm', names);
  selectedIds.value = new Set();
  searchKeyword.value = '';
  visible.value = false;
}

watch(visible, opened => {
  if (opened) {
    selectedIds.value = new Set();
    searchKeyword.value = '';
  }
});
</script>
