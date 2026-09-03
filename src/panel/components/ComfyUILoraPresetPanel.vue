<template>
  <div data-cv-tutorial="comfyui-lora-binding">
    <div class="mt-(--cv-space-10xl) mb-(--cv-space-3xl) flex items-center gap-(--cv-space-md)">
      <h2 class="cv-section-title m-0!">LoRA 库</h2>
      <i
        class="fa-solid fa-rotate cursor-pointer text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant) transition-colors duration-200 ease-in-out hover:text-(--cvp-primary-color)"
        :class="{ 'animate-spin': props.isLoadingLoras }"
        role="button"
        tabindex="0"
        aria-label="刷新 LoRA 库"
        @click="emit('refresh-options')"
        @keydown.enter="emit('refresh-options')"
      />
    </div>
    <div class="cv-section-body">
      <div class="cv-field p-0!">
        <PresetSelector
          :presets="presetOptions"
          :active-preset-id="props.presetSettings.activePresetId"
          :default-preset-id="defaultPresetId"
          @update:active-preset-id="updateActivePresetId"
          @create="createPreset"
          @clone="clonePreset"
          @rename="renamePreset"
          @delete-preset="deletePreset"
        />

        <Fluid v-if="activePreset?.loras.length" class="flex flex-col gap-(--cv-space-xl)">
          <div
            v-for="lora in activePreset.loras"
            :key="lora.id"
            class="border-b border-(--cv-surface-variant) pb-(--cv-space-lg) last:border-b-0 last:pb-0"
          >
            <!-- 名称行：LoRA 名称常显，不截断于 Select 内 -->
            <div class="flex items-center gap-(--cv-space-md)">
              <ToggleSwitch
                :model-value="lora.enabled"
                class="shrink-0 self-center"
                :aria-label="`${lora.name || '未命名 LoRA'} 启用状态`"
                @update:model-value="updateLora(lora.id, { enabled: Boolean($event) })"
              />
              <span
                class="min-w-0 flex-1 overflow-hidden font-mono text-(length:--cv-font-size-xs) text-(--cv-on-surface) text-ellipsis whitespace-nowrap"
                :class="{ 'text-(--cv-on-surface-variant)': !lora.name }"
                :title="lora.name || '未选择 LoRA'"
              >
                {{ lora.name || '未选择 LoRA' }}
              </span>
              <InputNumber
                :model-value="lora.strength"
                :min="-5"
                :max="5"
                :step="0.05"
                :min-fraction-digits="0"
                :max-fraction-digits="3"
                :use-grouping="false"
                fluid
                placeholder="强度"
                class="cv-lora-strength w-20 shrink-0 min-w-0"
                :pt="loraStrengthPt"
                aria-label="LoRA 强度"
                @update:model-value="updateLora(lora.id, { strength: normalizeStrength($event) })"
              />
              <Button
                icon="fa-solid fa-wand-magic-sparkles"
                severity="secondary"
                variant="text"
                rounded
                class="shrink-0 self-center"
                :class="{ 'text-(--cvp-primary-color)': lora.triggerWords.length }"
                title="触发词"
                aria-label="编辑 LoRA 触发词"
                @click="toggleTriggerWords(lora.id)"
              />
              <!-- 更换：点开内联 Select 选新 LoRA，选完自动收起 -->
              <Button
                v-if="lora.name && !swappingLoraIds.has(lora.id)"
                icon="fa-solid fa-arrow-right-arrow-left"
                severity="secondary"
                variant="text"
                rounded
                class="shrink-0 self-center"
                title="更换 LoRA"
                aria-label="更换 LoRA"
                @click="toggleSwap(lora.id)"
              />
              <Button
                icon="fa-solid fa-trash"
                severity="danger"
                variant="text"
                rounded
                class="shrink-0 self-center"
                aria-label="删除 LoRA"
                @click="removeLora(lora.id)"
              />
            </div>
            <!-- 名称过长或点「更换」时：独立一行展示 Select -->
            <div
              v-if="!lora.name || swappingLoraIds.has(lora.id)"
              class="mt-(--cv-space-md) pl-[calc(var(--cv-space-2xl)+1.5em)] max-[32rem]:pl-0"
            >
              <Select
                :model-value="lora.name"
                :options="props.loraOptions"
                option-label="label"
                option-value="value"
                placeholder="选择 ComfyUI LoRA"
                class="w-full max-w-full min-w-0"
                fluid
                :loading="props.isLoadingLoras"
                aria-label="LoRA 文件"
                filter
                autofocus
                @update:model-value="selectSwapLora(lora.id, String($event ?? ''))"
                @hide="closeSwap(lora.id)"
              />
            </div>
            <div v-if="expandedTriggerWordIds.has(lora.id)" class="mt-(--cv-space-md) pl-[calc(var(--cv-space-2xl)+1.5em)] max-[32rem]:pl-0">
              <InputText
                :model-value="lora.triggerWords.join(', ')"
                placeholder="触发词（逗号分隔，多个；生图时自动前置到正向提示词）"
                class="w-full"
                aria-label="LoRA 触发词"
                @update:model-value="updateLora(lora.id, { triggerWords: parseTriggerWords(String($event ?? '')) })"
              />
            </div>
          </div>
        </Fluid>
        <div
          v-else
          class="rounded-(--cv-radius) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) p-(--cv-space-xl) text-center text-(--cv-on-surface-variant)"
        >
          当前分组暂无 LoRA
        </div>

        <div class="flex flex-col gap-(--cv-space-sm)">
          <button
            type="button"
            class="flex w-full cursor-pointer items-center justify-center gap-(--cv-space-sm) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) bg-[color-mix(in_srgb,var(--cv-surface-container-low)_42%,transparent)] py-(--cv-space-md) text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant) transition-all duration-200 ease-in-out hover:border-(--cv-outline) hover:bg-(--cv-surface-container-low) hover:text-(--cvp-primary-color)"
            @click="addLora"
          >
            <i class="fa-solid fa-plus" />
            添加 LoRA
          </button>
          <button
            v-if="activePreset"
            type="button"
            class="flex w-full cursor-pointer items-center justify-center gap-(--cv-space-sm) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) bg-[color-mix(in_srgb,var(--cv-surface-container-low)_42%,transparent)] py-(--cv-space-md) text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant) transition-all duration-200 ease-in-out hover:border-(--cv-outline) hover:bg-(--cv-surface-container-low) hover:text-(--cvp-primary-color)"
            :class="{ 'pointer-events-none opacity-45': !props.loraOptions.length }"
            @click="isBulkAddVisible = true"
          >
            <i class="fa-solid fa-list-check" />
            批量添加
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 批量添加弹窗 -->
  <ComfyUILoraBulkAddDialog
    v-model:visible="isBulkAddVisible"
    :options="props.loraOptions"
    :existing-loras="activePreset?.loras ?? []"
    @confirm="addLorasBulk"
  />
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';

import {
  DEFAULT_COMFYUI_LORA_PRESET_ID,
  createComfyUILoraPreset,
  createComfyUILoraSetting,
  type ComfyUILoraPreset,
  type ComfyUILoraPresetSettings,
  type ComfyUILoraSetting,
} from '@/constants/comfyui';
import PresetSelector from '@/panel/components/PresetSelector.vue';
import ComfyUILoraBulkAddDialog from '@/panel/components/comfyui/ComfyUILoraBulkAddDialog.vue';
import { findComfyUILoraPreset } from '@/services/comfyui/lora-presets';

interface TextOption {
  value: string;
  label: string;
}

interface PresetOption {
  id: string;
  name: string;
}

const defaultPresetId = DEFAULT_COMFYUI_LORA_PRESET_ID;

/** LoRA 强度 InputNumber：内嵌 input 全宽居中，避免 :deep(.cv-prime-field) */
const loraStrengthPt = {
  pcInputText: { root: { class: 'cv-prime-field w-full text-center' } },
} as const;

const props = defineProps<{
  presetSettings: ComfyUILoraPresetSettings;
  loraOptions: TextOption[];
  isLoadingLoras: boolean;
}>();

const emit = defineEmits<{
  'update:preset-settings': [settings: ComfyUILoraPresetSettings];
  'refresh-options': [];
}>();

const showPrompt =
  inject<(options: { title?: string; message: string; defaultValue?: string }) => Promise<string | null>>('showPrompt');

const presetOptions = computed<PresetOption[]>(() => props.presetSettings.presets.map(toPresetOption));
const activePreset = computed(() =>
  findComfyUILoraPreset(props.presetSettings.presets, props.presetSettings.activePresetId),
);
/** 已展开触发词编辑的 LoRA 条目 ID */
const expandedTriggerWordIds = ref<ReadonlySet<string>>(new Set());
/** 正在更换 LoRA（显示内联 Select）的条目 ID */
const swappingLoraIds = ref<ReadonlySet<string>>(new Set());
/** 批量添加弹窗开合状态 */
const isBulkAddVisible = ref(false);

/**
 * 切换触发词编辑区的展开状态
 * @param id LoRA 条目 ID
 */
function toggleTriggerWords(id: string): void {
  const next = new Set(expandedTriggerWordIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedTriggerWordIds.value = next;
}

/**
 * 切换内联「更换 LoRA」Select 的展开状态
 * @param id LoRA 条目 ID
 */
function toggleSwap(id: string): void {
  const next = new Set(swappingLoraIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  swappingLoraIds.value = next;
}

/**
 * 关闭内联更换 Select（下拉收起或选择完成）
 * @param id LoRA 条目 ID
 */
function closeSwap(id: string): void {
  if (!swappingLoraIds.value.has(id)) return;
  const next = new Set(swappingLoraIds.value);
  next.delete(id);
  swappingLoraIds.value = next;
}

/**
 * 选择更换后的 LoRA 并收起 Select
 * @param id LoRA 条目 ID
 * @param name 新 LoRA 名称
 */
function selectSwapLora(id: string, name: string): void {
  updateLora(id, { name });
  closeSwap(id);
}

/**
 * 解析触发词输入文本（逗号或换行分隔）
 * @param value 输入文本
 * @returns 触发词列表
 */
function parseTriggerWords(value: string): string[] {
  return value
    .split(/[,\n]+/)
    .map(word => word.trim())
    .filter(Boolean);
}

/**
 * 转换预设选择器选项
 * @param preset LoRA 预设组
 * @returns 预设选择器选项
 */
function toPresetOption(preset: ComfyUILoraPreset): PresetOption {
  return { id: preset.id, name: getPresetName(preset) };
}

/**
 * 切换当前激活的 LoRA 预设组
 * @param activePresetId 新预设组 ID
 */
function updateActivePresetId(activePresetId: string): void {
  emit('update:preset-settings', { ...props.presetSettings, activePresetId });
}

/**
 * 新建 LoRA 预设组
 */
async function createPreset(): Promise<void> {
  const name = await askPresetName('请输入新预设组的名称：', '新 LoRA 组');
  if (!name) return;
  const preset = createComfyUILoraPreset(uuidv4(), name);
  emitPresetSettings([...props.presetSettings.presets, preset], preset.id);
  toastr.success(`预设组 "${name}" 已创建`);
}

/**
 * 克隆当前激活的 LoRA 预设组
 */
async function clonePreset(): Promise<void> {
  if (!activePreset.value) return;
  const name = await askPresetName('请输入克隆预设组的名称：', `${getPresetName(activePreset.value)} - 副本`);
  if (!name) return;
  const preset = {
    ...activePreset.value,
    id: uuidv4(),
    name,
    loras: activePreset.value.loras.map(cloneLoraSetting),
  };
  emitPresetSettings([...props.presetSettings.presets, preset], preset.id);
  toastr.success(`已克隆到新预设组 "${name}"`);
}

/**
 * 重命名当前激活的 LoRA 预设组
 */
async function renamePreset(): Promise<void> {
  if (!activePreset.value) return;
  const name = await askPresetName('请输入新的预设组名称：', getPresetName(activePreset.value));
  if (!name) return;
  updatePreset(activePreset.value.id, preset => ({ ...preset, name }));
  toastr.success('预设组已重命名');
}

/**
 * 删除指定 LoRA 预设组
 * @param id 预设组 ID
 */
function deletePreset(id: string): void {
  const presets = props.presetSettings.presets.filter(preset => preset.id !== id);
  emitPresetSettings(presets, getFallbackPresetId(presets, props.presetSettings.activePresetId));
  toastr.success('预设组已删除');
}

/**
 * 在当前激活组内新增空白 LoRA
 */
function addLora(): void {
  if (!activePreset.value) return;
  updatePreset(activePreset.value.id, preset => ({ ...preset, loras: [...preset.loras, createBlankLora()] }));
}

/**
 * 批量添加 LoRA（默认禁用，需手动启用）
 * @param names LoRA 名称列表
 */
function addLorasBulk(names: string[]): void {
  if (!activePreset.value || !names.length) return;
  updatePreset(activePreset.value.id, preset => ({
    ...preset,
    loras: [...preset.loras, ...names.map(name => createComfyUILoraSetting(uuidv4(), { name, enabled: false }))],
  }));
  toastr.success(`已批量添加 ${names.length} 个 LoRA（默认禁用）`);
}

/**
 * 删除当前激活组中的 LoRA
 * @param id LoRA 条目 ID
 */
function removeLora(id: string): void {
  if (!activePreset.value) return;
  updatePreset(activePreset.value.id, preset => ({ ...preset, loras: preset.loras.filter(lora => lora.id !== id) }));
}

/**
 * 更新当前激活组中的单个 LoRA
 * @param id LoRA 条目 ID
 * @param overrides 需要覆写的字段
 */
function updateLora(id: string, overrides: Partial<Omit<ComfyUILoraSetting, 'id'>>): void {
  if (!activePreset.value) return;
  updatePreset(activePreset.value.id, preset => ({
    ...preset,
    loras: preset.loras.map(lora => (lora.id === id ? { ...lora, ...overrides } : lora)),
  }));
}

/**
 * 更新单个 LoRA 预设组
 * @param id 预设组 ID
 * @param updater 更新函数
 */
function updatePreset(id: string, updater: (preset: ComfyUILoraPreset) => ComfyUILoraPreset): void {
  const presets = props.presetSettings.presets.map(preset => (preset.id === id ? updater(preset) : preset));
  emitPresetSettings(presets, props.presetSettings.activePresetId);
}

/**
 * 提交新的 LoRA 预设组集合
 * @param presets 新预设组列表
 * @param activePresetId 新激活预设组 ID
 */
function emitPresetSettings(presets: ComfyUILoraPreset[], activePresetId: string): void {
  emit('update:preset-settings', { presets, activePresetId });
}

/**
 * 创建空白 LoRA 条目
 * @returns 空白 LoRA 设置
 */
function createBlankLora(): ComfyUILoraSetting {
  return createComfyUILoraSetting(uuidv4());
}

/**
 * 克隆 LoRA 条目
 * @param lora 源条目
 * @returns 新条目
 */
function cloneLoraSetting(lora: ComfyUILoraSetting): ComfyUILoraSetting {
  return { ...lora, id: uuidv4(), triggerWords: [...lora.triggerWords] };
}

/**
 * 规范化强度值
 * @param value 输入值
 * @returns 合法强度
 */
function normalizeStrength(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 1;
  return Math.min(5, Math.max(-5, value));
}

/**
 * 读取预设组显示名
 * @param preset 预设组
 * @returns 名称
 */
function getPresetName(preset: ComfyUILoraPreset): string {
  return preset.name?.trim() || '未命名';
}

/**
 * 询问预设组名称
 * @param message 提示文案
 * @param defaultValue 默认值
 * @returns 名称或 null
 */
async function askPresetName(message: string, defaultValue: string): Promise<string | null> {
  if (!showPrompt) return defaultValue;
  const name = await showPrompt({ title: 'LoRA 预设组', message, defaultValue });
  const trimmed = name?.trim() ?? '';
  return trimmed || null;
}

/**
 * 删除后回退到可用预设组
 * @param presets 剩余预设组
 * @param preferredId 期望保留的预设组 ID
 * @returns 可用预设组 ID
 */
function getFallbackPresetId(presets: ComfyUILoraPreset[], preferredId: string): string {
  return (
    presets.find(preset => preset.id === preferredId)?.id ??
    presets.find(preset => preset.id === defaultPresetId)?.id ??
    presets[0]?.id ??
    defaultPresetId
  );
}
</script>
