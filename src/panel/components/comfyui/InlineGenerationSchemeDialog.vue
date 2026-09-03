<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissable-mask
    :draggable="false"
    header="生图方案"
    :style="DIALOG_STYLE"
    :content-style="{ overflow: 'hidden' }"
  >
    <div
      class="flex max-h-[min(70vh,36rem)] w-full flex-col gap-(--cv-space-3xl) overflow-y-auto overscroll-contain custom-scrollbar"
    >
      <!-- 本图方案（快照对比） -->
      <div
        v-if="snapshot"
        class="flex flex-col gap-(--cv-space-xs) rounded-(--cv-radius-sm) bg-(--cv-surface-container-low) px-(--cv-space-lg) py-(--cv-space-md)"
      >
        <div class="text-(length:--cv-font-size-xs) font-semibold text-(--cv-on-surface)">本图使用的方案</div>
        <div class="flex flex-col gap-(--cv-space-2xs)">
          <div class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            工作流：{{ snapshot.comfyui?.workflowPresetName || '未知（旧图片）' }}
          </div>
          <div class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            LoRA 组：{{ snapshot.comfyui?.loraPresetName || '未知（旧图片）' }}
          </div>
          <div class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            分辨率：{{ formatResolution(snapshot.comfyui?.resolution) }}
          </div>
          <div class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            LoRA：{{ formatSnapshotLoras(snapshot.comfyui?.loras) }}
          </div>
        </div>
      </div>

      <!-- LoRA 预设组 -->
      <div class="flex min-w-0 flex-col gap-(--cv-space-md)">
        <div class="text-(length:--cv-font-size-xs) font-semibold leading-[1.4] text-(--cv-on-surface)">
          LoRA 组合（点击切换）
        </div>
        <button
          v-for="preset in loraPresets"
          :key="preset.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid px-(--cv-space-lg) py-(--cv-space-md) text-left transition-colors duration-150"
          :class="
            preset.id === activeLoraPresetId
              ? 'border-(--cvp-primary-color) bg-(--cv-surface-container-low)'
              : 'border-(--cv-surface-variant) bg-transparent hover:bg-(--cv-surface-container-highest)'
          "
          @click="selectLoraPreset(preset)"
        >
          <i
            class="shrink-0 text-(length:--cv-font-size-xs)"
            :class="preset.id === activeLoraPresetId ? 'fa-solid fa-circle-dot text-(--cvp-primary-color)' : 'fa-regular fa-circle text-(--cv-on-surface-variant)'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-(--cv-on-surface)">{{
            preset.name?.trim() || '未命名'
          }}</span>
          <span class="shrink-0 font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            {{ countEnabledLoras(preset) }}/{{ preset.loras.length }} LoRA
          </span>
        </button>
      </div>

      <!-- 工作流预设 -->
      <div class="flex min-w-0 flex-col gap-(--cv-space-md)">
        <div class="text-(length:--cv-font-size-xs) font-semibold leading-[1.4] text-(--cv-on-surface)">
          工作流预设（点击切换）
        </div>
        <button
          v-for="preset in workflowPresets"
          :key="preset.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid px-(--cv-space-lg) py-(--cv-space-md) text-left transition-colors duration-150"
          :class="
            preset.id === activeWorkflowPresetId
              ? 'border-(--cvp-primary-color) bg-(--cv-surface-container-low)'
              : 'border-(--cv-surface-variant) bg-transparent hover:bg-(--cv-surface-container-highest)'
          "
          @click="selectWorkflowPreset(preset)"
        >
          <i
            class="shrink-0 text-(length:--cv-font-size-xs)"
            :class="preset.id === activeWorkflowPresetId ? 'fa-solid fa-circle-dot text-(--cvp-primary-color)' : 'fa-regular fa-circle text-(--cv-on-surface-variant)'"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-(--cv-on-surface)">{{
            preset.name?.trim() || '未命名'
          }}</span>
          <span
            v-if="preset.id === activeWorkflowPresetId"
            class="shrink-0 font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
          >
            {{ formatResolution(currentResolution) }}
          </span>
        </button>
      </div>

      <!-- 分辨率组合 -->
      <div class="flex min-w-0 flex-col gap-(--cv-space-md)">
        <div class="flex items-baseline justify-between gap-(--cv-space-md)">
          <div class="text-(length:--cv-font-size-xs) font-semibold leading-[1.4] text-(--cv-on-surface)">
            分辨率组合（应用到当前工作流）
          </div>
          <span class="shrink-0 font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            当前: {{ formatResolution(currentResolution) }}
          </span>
        </div>
        <div
          v-if="resolutionCombos.length"
          class="flex flex-col gap-(--cv-space-xs)"
        >
          <button
            v-for="combo in resolutionCombos"
            :key="combo.id"
            type="button"
            class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid px-(--cv-space-lg) py-(--cv-space-md) text-left transition-colors duration-150"
            :class="
              isComboActive(combo)
                ? 'border-(--cvp-primary-color) bg-(--cv-surface-container-low)'
                : 'border-(--cv-surface-variant) bg-transparent hover:bg-(--cv-surface-container-highest)'
            "
            @click="applyCombo(combo)"
          >
            <i
              class="shrink-0 text-(length:--cv-font-size-xs)"
              :class="isComboActive(combo) ? 'fa-solid fa-check text-(--cvp-primary-color)' : 'fa-solid fa-arrows-up-down-left-right text-(--cv-on-surface-variant)'"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-(--cv-on-surface)">{{
              combo.name
            }}</span>
            <span class="shrink-0 font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
              {{ combo.width }} × {{ combo.height }}
            </span>
          </button>
        </div>
        <div
          v-else
          class="rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) px-(--cv-space-lg) py-(--cv-space-md) text-center text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
        >
          暂无收藏的分辨率组合，可在设置 → ComfyUI → 分辨率组合中添加
        </div>
      </div>

      <div class="text-(length:--cv-font-size-xs) leading-[1.5] text-(--cv-on-surface-variant)">
        <i class="fa-solid fa-circle-info" aria-hidden="true" />
        切换后重新生图、编辑TAG后生图与新请求均使用当前方案
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import type { ComfyUILoraPreset, ComfyUIResolutionCombo, ComfyUIWorkflowPreset } from '@/constants/comfyui';
import type { InlinePromptSnapshot } from '@/composables/inlineImageLightbox';
import { sortResolutionCombos, listResolutionTargets, applyResolutionToTarget } from '@/services/comfyui/resolution-combos';
import { parseComfyUIWorkflow, serializeComfyUIWorkflow } from '@/services/comfyui/parse';
import { getActiveComfyUIWorkflowPreset } from '@/services/comfyui/workflow-presets';
import { useSettingsStore } from '@/store/settings';
import { storeToRefs } from 'pinia';

/** 弹窗尺寸 */
const DIALOG_STYLE = {
  width: '26rem',
  maxWidth: 'calc(100vw - 2rem)',
} as const;

const visible = defineModel<boolean>('visible', { required: true });

const props = defineProps<{
  /** 当前图片的提示词快照（用于展示本图方案；无则不显示对比区） */
  snapshot?: InlinePromptSnapshot | null;
}>();

const settingsStore = useSettingsStore();
const { savedSettings } = storeToRefs(settingsStore);
const comfyui = computed(() => savedSettings.value.comfyui);

const loraPresets = computed(() => comfyui.value.loraPresets.presets);
const activeLoraPresetId = computed(() => comfyui.value.loraPresets.activePresetId);
const workflowPresets = computed(() => comfyui.value.workflowPresets.presets);
const activeWorkflowPresetId = computed(() => comfyui.value.workflowPresets.activePresetId);
const resolutionCombos = computed(() => sortResolutionCombos(comfyui.value.resolutionCombos));
/** 当前工作流实际分辨率（读取失败或无尺寸节点时为 null） */
const currentResolution = computed(() => readWorkflowResolution());

/**
 * 读取当前激活工作流的首个分辨率目标尺寸
 * @returns 分辨率或 null
 */
function readWorkflowResolution(): { width: number; height: number } | null {
  try {
    const workflow = parseComfyUIWorkflow(getActiveComfyUIWorkflowPreset(comfyui.value.workflowPresets).workflowJson);
    const target = listResolutionTargets(workflow)[0];
    return target ? { width: target.width, height: target.height } : null;
  } catch {
    return null;
  }
}

/**
 * 切换 LoRA 预设组
 * @param preset 目标预设组
 */
function selectLoraPreset(preset: ComfyUILoraPreset): void {
  if (preset.id === activeLoraPresetId.value) return;
  comfyui.value.loraPresets.activePresetId = preset.id;
  settingsStore.persistSavedSettings();
  toastr.success(`已切换 LoRA 组「${preset.name?.trim() || '未命名'}」`);
}

/**
 * 切换工作流预设
 * @param preset 目标预设
 */
function selectWorkflowPreset(preset: ComfyUIWorkflowPreset): void {
  if (preset.id === activeWorkflowPresetId.value) return;
  comfyui.value.workflowPresets.activePresetId = preset.id;
  settingsStore.persistSavedSettings();
  toastr.success(`已切换工作流「${preset.name?.trim() || '未命名'}」`);
}

/**
 * 应用分辨率组合到当前工作流（多目标时选择首个失败则提示）
 * @param combo 目标组合
 */
function applyCombo(combo: ComfyUIResolutionCombo): void {
  const preset = getActiveComfyUIWorkflowPreset(comfyui.value.workflowPresets);
  let workflow: ReturnType<typeof parseComfyUIWorkflow>;
  try {
    workflow = parseComfyUIWorkflow(preset.workflowJson);
  } catch (error) {
    toastr.warning(error instanceof Error ? error.message : '工作流解析失败');
    return;
  }
  const targets = listResolutionTargets(workflow);
  if (!targets.length) {
    toastr.warning('当前工作流没有可写尺寸的节点');
    return;
  }
  const target = targets[0]!;
  if (!applyResolutionToTarget(workflow, target, combo)) {
    toastr.warning('目标写入点缺少可写的尺寸输入');
    return;
  }
  preset.workflowJson = serializeComfyUIWorkflow(workflow);
  settingsStore.persistSavedSettings();
  toastr.success(`已将「${combo.name}」(${combo.width}×${combo.height}) 应用到当前工作流`);
}

/**
 * 判断组合是否与当前工作流分辨率一致
 * @param combo 目标组合
 * @returns 是否一致
 */
function isComboActive(combo: ComfyUIResolutionCombo): boolean {
  const current = currentResolution.value;
  return Boolean(current && current.width === combo.width && current.height === combo.height);
}

/**
 * 统计启用中的 LoRA 数量
 * @param preset LoRA 预设组
 * @returns 启用数
 */
function countEnabledLoras(preset: ComfyUILoraPreset): number {
  return preset.loras.filter(lora => lora.enabled).length;
}

/**
 * 格式化分辨率展示文本
 * @param resolution 分辨率
 * @returns 文本
 */
function formatResolution(resolution?: { width: number; height: number } | null): string {
  return resolution ? `${resolution.width}×${resolution.height}` : '未知';
}

/**
 * 格式化快照 LoRA 列表展示文本
 * @param loras LoRA 快照列表
 * @returns 文本
 */
function formatSnapshotLoras(loras?: { name: string; strength: number }[]): string {
  if (!loras?.length) return '无';
  const names = loras.map(lora => lora.name);
  const joined = names.join(', ');
  return names.length > 3 ? `${joined.slice(0, 40)}…` : joined;
}
</script>
