<template>
  <StaticPanel title="分辨率组合">
    <template #actions>
      <span class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
        {{ combos.length }} / {{ MAX_RESOLUTION_COMBOS }}
      </span>
    </template>

    <!-- 组合列表 -->
    <Fluid v-if="sortedCombos.length" class="flex flex-col gap-(--cv-space-xl)">
      <div
        v-for="combo in sortedCombos"
        :key="combo.id"
        class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-(--cv-space-md) border-b border-(--cv-surface-variant) pb-(--cv-space-lg) last:border-b-0 last:pb-0"
      >
        <div class="flex min-w-0 flex-col gap-(--cv-space-xs)">
          <span class="overflow-hidden text-ellipsis whitespace-nowrap text-(--cv-on-surface)">{{ combo.name }}</span>
          <span class="font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            {{ combo.width }} × {{ combo.height }}
          </span>
        </div>
        <Button
          label="应用"
          icon="fa-solid fa-arrow-right-to-bracket"
          severity="secondary"
          variant="text"
          size="small"
          class="shrink-0"
          :title="`将 ${combo.width}×${combo.height} 写入工作流节点`"
          @click="applyCombo(combo)"
        />
        <div class="flex shrink-0 items-center gap-(--cv-space-sm)">
          <Button
            icon="fa-solid fa-pen"
            severity="secondary"
            variant="text"
            rounded
            size="small"
            aria-label="编辑组合"
            title="编辑组合"
            @click="openEditor(combo)"
          />
          <Button
            icon="fa-solid fa-trash"
            severity="danger"
            variant="text"
            rounded
            size="small"
            aria-label="删除组合"
            title="删除组合"
            @click="confirmRemove(combo)"
          />
        </div>
      </div>
    </Fluid>
    <div
      v-else
      class="rounded-(--cv-radius) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) p-(--cv-space-xl) text-center text-(--cv-on-surface-variant)"
    >
      暂无分辨率组合，点击下方新增
    </div>

    <CvAddEntryButton label="新增组合" :disabled="isFull" @click="openEditor(null)" />
    <div v-if="isFull" class="cv-field-hint">已达上限 {{ MAX_RESOLUTION_COMBOS }} 组，请先删除部分组合</div>
  </StaticPanel>

  <!-- 新增 / 编辑弹窗 -->
  <Dialog
    v-model:visible="isEditorVisible"
    modal
    dismissable-mask
    :header="editorDraft?.id ? '编辑分辨率组合' : '新增分辨率组合'"
    :style="EDITOR_DIALOG_STYLE"
  >
    <div v-if="editorDraft" class="flex flex-col gap-(--cv-space-3xl)">
      <label class="cv-field">
        <span>名称</span>
        <InputText v-model="editorDraft.name" placeholder="如：人物立绘" fluid autofocus />
      </label>
      <div class="grid grid-cols-2 gap-(--cv-space-md)">
        <label class="cv-field min-w-0">
          <span>宽</span>
          <Select
            v-model="editorDraft.width"
            :options="COMFYUI_DIMENSION_PRESETS"
            editable
            fluid
            class="w-full"
          />
        </label>
        <label class="cv-field min-w-0">
          <span>高</span>
          <Select
            v-model="editorDraft.height"
            :options="COMFYUI_DIMENSION_PRESETS"
            editable
            fluid
            class="w-full"
          />
        </label>
      </div>
      <div v-if="editorError" class="cv-field-warn">{{ editorError }}</div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-(--cv-space-sm)">
        <Button label="取消" text @click="isEditorVisible = false" />
        <Button label="保存" icon="fa-solid fa-check" @click="saveEditor" />
      </div>
    </template>
  </Dialog>

  <!-- 多目标节点时选择应用目标 -->
  <Dialog
    v-model:visible="isTargetPickerVisible"
    modal
    dismissable-mask
    header="选择应用目标节点"
    :style="EDITOR_DIALOG_STYLE"
  >
    <div class="flex flex-col gap-(--cv-space-sm)">
      <div class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
        当前工作流有多个可写尺寸的节点，选择要应用
        <span class="font-mono">{{ pendingCombo?.width }}×{{ pendingCombo?.height }}</span> 的节点：
      </div>
      <button
        v-for="target in targetNodes"
        :key="target.key"
        type="button"
        class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid border-(--cv-surface-variant) bg-transparent px-(--cv-space-lg) py-(--cv-space-md) text-left text-(--cv-on-surface) hover:bg-(--cv-surface-container-highest)"
        @click="applyToTarget(target)"
      >
        <span class="font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">#{{ target.nodeId }}</span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{ target.title }}</span>
          <span class="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            {{ target.detail }}
          </span>
        </span>
        <span class="shrink-0 font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
          {{ target.width }}×{{ target.height }}
        </span>
      </button>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <Button label="取消" text @click="isTargetPickerVisible = false" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import {
  COMFYUI_DIMENSION_PRESETS,
  createComfyUIResolutionCombo,
  type ComfyUIResolutionCombo,
} from '@/constants/comfyui';
import CvAddEntryButton from '@/panel/components/CvAddEntryButton.vue';
import StaticPanel from '@/panel/components/StaticPanel.vue';
import { requestConfirmation, type ShowConfirm } from '@/panel/confirm-action';
import { parseComfyUIWorkflow, serializeComfyUIWorkflow } from '@/services/comfyui/parse';
import {
  addResolutionCombo,
  applyResolutionToTarget,
  createResolutionComboId,
  listResolutionTargets,
  MAX_RESOLUTION_COMBOS,
  removeResolutionCombo,
  sortResolutionCombos,
  updateResolutionCombo,
  type ResolutionTarget,
} from '@/services/comfyui/resolution-combos';
import type { ComfyUIWorkflow } from '@/services/comfyui/types';

/** 编辑弹窗尺寸 */
const EDITOR_DIALOG_STYLE = {
  width: '26rem',
  maxWidth: 'calc(100vw - 2rem)',
} as const;

/** 组合编辑草稿 */
interface ComboDraft {
  id: string | null;
  name: string;
  width: number | string;
  height: number | string;
}

const props = defineProps<{
  combos: ComfyUIResolutionCombo[];
  /** 当前工作流 JSON（应用目标来源） */
  workflowJson: string;
}>();

const emit = defineEmits<{
  'update:combos': [combos: ComfyUIResolutionCombo[]];
  'update:workflow-json': [json: string];
}>();

const showConfirm = inject<ShowConfirm>('showConfirm');

const isEditorVisible = ref(false);
const editorDraft = ref<ComboDraft | null>(null);
const editorError = ref('');
const isTargetPickerVisible = ref(false);
const pendingCombo = ref<ComfyUIResolutionCombo | null>(null);
const targetNodes = ref<ResolutionTarget[]>([]);

const sortedCombos = computed(() => sortResolutionCombos(props.combos));
const isFull = computed(() => props.combos.length >= MAX_RESOLUTION_COMBOS);

/**
 * 打开新增/编辑弹窗
 * @param combo 目标组合；null 表示新增
 */
function openEditor(combo: ComfyUIResolutionCombo | null): void {
  if (!combo && isFull.value) return;
  editorDraft.value = combo
    ? { id: combo.id, name: combo.name, width: combo.width, height: combo.height }
    : { id: null, name: '', width: 832, height: 1216 };
  editorError.value = '';
  isEditorVisible.value = true;
}

/**
 * 保存新增/编辑结果
 */
function saveEditor(): void {
  const draft = editorDraft.value;
  if (!draft) return;
  const name = draft.name.trim();
  const width = normalizeDimension(draft.width);
  const height = normalizeDimension(draft.height);
  if (!name) {
    editorError.value = '请填写组合名称';
    return;
  }
  if (!width || !height) {
    editorError.value = '宽高必须是大于 0 的整数';
    return;
  }

  if (draft.id) {
    emit('update:combos', updateResolutionCombo(props.combos, draft.id, { name, width, height }));
  } else {
    try {
      emit(
        'update:combos',
        addResolutionCombo(props.combos, createComfyUIResolutionCombo(createResolutionComboId(), name, width, height)),
      );
    } catch (error) {
      editorError.value = error instanceof Error ? error.message : '保存失败';
      return;
    }
  }
  isEditorVisible.value = false;
  editorDraft.value = null;
}

/**
 * 规范化尺寸输入（可编辑下拉可能返回字符串）
 * @param value 原始值
 * @returns 正整数；非法返回 0
 */
function normalizeDimension(value: number | string): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num);
}

/**
 * 确认后删除组合
 * @param combo 目标组合
 */
async function confirmRemove(combo: ComfyUIResolutionCombo): Promise<void> {
  const confirmed = await requestConfirmation(showConfirm, {
    title: '删除分辨率组合',
    message: `确定要删除「${combo.name}」(${combo.width}×${combo.height}) 吗？`,
    acceptLabel: '确认删除',
    cancelLabel: '取消',
    severity: 'danger',
  });
  if (confirmed) emit('update:combos', removeResolutionCombo(props.combos, combo.id));
}

/**
 * 应用组合到工作流：单目标直接写入，多目标弹选择器
 * @param combo 目标组合
 */
function applyCombo(combo: ComfyUIResolutionCombo): void {
  const workflow = readWorkflow();
  if (!workflow) return;
  const targets = listResolutionTargets(workflow);
  if (!targets.length) {
    toastr.warning('当前工作流没有可写尺寸的节点');
    return;
  }
  if (targets.length === 1) {
    writeComboToTarget(workflow, targets[0]!, combo);
    return;
  }
  pendingCombo.value = combo;
  targetNodes.value = targets;
  isTargetPickerVisible.value = true;
}

/**
 * 应用待写入组合到指定节点（多目标选择后）
 * @param nodeId 目标节点 ID
 */
function applyToTarget(target: ResolutionTarget): void {
  const combo = pendingCombo.value;
  const workflow = readWorkflow();
  if (!combo || !workflow) return;
  writeComboToTarget(workflow, target, combo);
  isTargetPickerVisible.value = false;
  pendingCombo.value = null;
}

/**
 * 写入组合并提交工作流
 * @param workflow 工作流对象
 * @param nodeId 目标节点 ID
 * @param combo 组合
 * @param title 节点显示名（提示用）
 */
function writeComboToTarget(workflow: ComfyUIWorkflow, target: ResolutionTarget, combo: ComfyUIResolutionCombo): void {
  if (!applyResolutionToTarget(workflow, target, combo)) {
    toastr.warning('目标写入点缺少可写的尺寸输入');
    return;
  }
  emit('update:workflow-json', serializeComfyUIWorkflow(workflow));
  toastr.success(`已将「${combo.name}」(${combo.width}×${combo.height}) 应用到 #${target.nodeId} ${target.title}`);
}

/**
 * 解析当前工作流 JSON
 * @returns 工作流对象；解析失败返回 null 并提示
 */
function readWorkflow(): ComfyUIWorkflow | null {
  try {
    return parseComfyUIWorkflow(props.workflowJson);
  } catch (error) {
    toastr.warning(error instanceof Error ? error.message : '工作流解析失败');
    return null;
  }
}
</script>
