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
            <!-- 单行：迷你开关 + 名称 + 内联强度 + 更多 -->
            <div class="flex items-center gap-(--cv-space-sm)">
              <CvMiniToggleSwitch
                :model-value="lora.enabled"
                :aria-label="`${lora.name || '未命名 LoRA'} 启用状态`"
                @update:model-value="updateLora(lora.id, { enabled: Boolean($event) })"
              />
              <span
                class="min-w-0 flex-1 overflow-hidden font-mono text-(length:--cv-font-size-xs) text-ellipsis whitespace-nowrap transition-colors duration-200 ease-in-out"
                :class="[
                  lora.name ? 'cursor-pointer text-(--cv-on-surface) hover:text-(--cvp-primary-color)' : 'text-(--cv-on-surface-variant)',
                ]"
                :title="lora.name ? `${lora.name}（点击查看预览图）` : '未选择 LoRA'"
                :role="lora.name ? 'button' : undefined"
                :tabindex="lora.name ? 0 : undefined"
                @click="lora.name && togglePreview(lora.id, lora.name, $event)"
                @keydown.enter="lora.name && togglePreview(lora.id, lora.name, $event)"
              >
                {{ lora.name || '未选择 LoRA' }}
              </span>
              <CvInlineNumber
                :model-value="lora.strength"
                :min="-5"
                :max="5"
                :step="0.05"
                :max-fraction-digits="3"
                aria-label="LoRA 强度"
                @update:model-value="updateLora(lora.id, { strength: normalizeStrength($event) })"
              />
              <CvMiniButton
                :tone="lora.triggerWords.length ? 'primary' : 'neutral'"
                icon="fa-solid fa-ellipsis"
                title="更多操作"
                aria-label="更多操作"
                @click="toggleMoreMenu(lora.id, $event)"
              />
            </div>
            <!-- 更多菜单：触发词 / 更换 / 删除 -->
            <Popover
              v-if="moreMenuIds.has(lora.id)"
              :ref="el => setMoreMenuRef(lora.id, el)"
              append-to="body"
            >
              <div class="flex w-[10rem] flex-col gap-(--cv-space-2xs) p-(--cv-space-xs)">
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-0 bg-transparent px-(--cv-space-lg) py-(--cv-space-sm) text-left text-(length:--cv-font-size-xs) text-(--cv-on-surface) transition-colors duration-150 hover:bg-(--cv-surface-container-highest)"
                  :class="{ 'text-(--cvp-primary-color)': lora.triggerWords.length }"
                  @click="onMoreAction(lora.id, () => toggleTriggerWords(lora.id))"
                >
                  <i class="fa-solid fa-wand-magic-sparkles w-4 text-center" aria-hidden="true" />
                  触发词{{ lora.triggerWords.length ? `（${lora.triggerWords.length}）` : '' }}
                </button>
                <button
                  v-if="lora.name"
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-0 bg-transparent px-(--cv-space-lg) py-(--cv-space-sm) text-left text-(length:--cv-font-size-xs) text-(--cv-on-surface) transition-colors duration-150 hover:bg-(--cv-surface-container-highest)"
                  @click="onMoreAction(lora.id, () => toggleSwap(lora.id))"
                >
                  <i class="fa-solid fa-arrow-right-arrow-left w-4 text-center" aria-hidden="true" />
                  更换
                </button>
                <button
                  type="button"
                  class="flex w-full cursor-pointer items-center gap-(--cv-space-md) rounded-(--cv-radius-sm) border-0 bg-transparent px-(--cv-space-lg) py-(--cv-space-sm) text-left text-(length:--cv-font-size-xs) text-(--cvp-red-500) transition-colors duration-150 hover:bg-(--cv-surface-container-highest)"
                  @click="onMoreAction(lora.id, () => removeLora(lora.id))"
                >
                  <i class="fa-solid fa-trash w-4 text-center" aria-hidden="true" />
                  删除
                </button>
              </div>
            </Popover>
            <!-- 预览图浮层：点击 LoRA 名称触发 -->
            <Popover
              v-if="previewLoraId === lora.id"
              :ref="el => setPreviewPopoverRef(el)"
              append-to="body"
            >
              <div class="flex max-h-[24rem] w-[min(20rem,80vw)] flex-col gap-(--cv-space-sm) p-(--cv-space-xs)">
                <div v-if="previewState.status === 'loading'" class="flex items-center justify-center gap-(--cv-space-sm) py-(--cv-space-2xl) text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
                  <i class="fa-solid fa-spinner animate-spin" aria-hidden="true" />
                  正在加载预览图…
                </div>
                <template v-else-if="previewState.status === 'ready'">
                  <img
                    :src="previewState.url"
                    :alt="`${lora.name} 预览图`"
                    class="max-h-[20rem] w-full rounded-(--cv-radius-sm) object-contain"
                    loading="lazy"
                    @error="onPreviewImageError"
                  >
                  <div v-if="previewState.imageFailed" class="text-center text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
                    预览图加载失败（缓存地址可能已失效）
                  </div>
                </template>
                <div v-else class="flex items-center justify-center gap-(--cv-space-sm) px-(--cv-space-md) py-(--cv-space-2xl) text-center text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
                  <i class="fa-solid fa-image-slash" aria-hidden="true" />
                  {{ previewState.message }}
                </div>
              </div>
            </Popover>
            <!-- 未选择或点「更换」时：独立一行展示 Select -->
            <div
              v-if="!lora.name || swappingLoraIds.has(lora.id)"
              class="mt-(--cv-space-md) pl-(--cv-space-2xl) max-[32rem]:pl-0"
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
            <div
              v-if="expandedTriggerWordIds.has(lora.id)"
              class="mt-(--cv-space-md) flex items-center gap-(--cv-space-sm) pl-(--cv-space-2xl) max-[32rem]:pl-0"
            >
              <InputText
                :model-value="lora.triggerWords.join(', ')"
                placeholder="触发词（逗号分隔，多个；生图时自动前置到正向提示词）"
                class="min-w-0 flex-1"
                aria-label="LoRA 触发词"
                @update:model-value="updateLora(lora.id, { triggerWords: parseTriggerWords(String($event ?? '')) })"
              />
              <CvMiniButton
                :icon="
                  fetchingTriggerWordIds.has(lora.id)
                    ? 'fa-solid fa-spinner animate-spin'
                    : 'fa-solid fa-cloud-arrow-down'
                "
                :disabled="!lora.name || fetchingTriggerWordIds.has(lora.id)"
                title="从 LoRA Manager 获取触发词（与现有触发词合并）"
                aria-label="获取触发词"
                @click="fetchTriggerWords(lora.id)"
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
          <button
            v-if="activePreset?.loras.length"
            type="button"
            class="flex w-full cursor-pointer items-center justify-center gap-(--cv-space-sm) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) bg-[color-mix(in_srgb,var(--cv-surface-container-low)_42%,transparent)] py-(--cv-space-md) text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant) transition-all duration-200 ease-in-out hover:border-(--cv-outline) hover:bg-(--cv-surface-container-low) hover:text-(--cvp-primary-color)"
            :class="{ 'pointer-events-none opacity-45': isFetchingTriggerWordsBulk }"
            title="为组内尚未填写触发词的 LoRA 批量拉取（已填写的不会被覆盖）"
            @click="fetchMissingTriggerWords"
          >
            <i
              :class="
                isFetchingTriggerWordsBulk ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-cloud-arrow-down'
              "
            />
            自动获取触发词
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
import CvInlineNumber from '@/panel/components/CvInlineNumber.vue';
import CvMiniButton from '@/panel/components/CvMiniButton.vue';
import CvMiniToggleSwitch from '@/panel/components/CvMiniToggleSwitch.vue';
import { dedupeTriggerWords, findComfyUILoraPreset } from '@/services/comfyui/lora-presets';
import {
  fetchComfyUILoraTriggerWords,
  fetchComfyUILoraTriggerWordsBatch,
  type ComfyUILoraTriggerWordsBatchResult,
} from '@/services/comfyui/lora-trigger-words';
import { fetchComfyUILoraPreviewUrl } from '@/services/comfyui/lora-preview';

interface TextOption {
  value: string;
  label: string;
}

interface PresetOption {
  id: string;
  name: string;
}

const defaultPresetId = DEFAULT_COMFYUI_LORA_PRESET_ID;

const props = defineProps<{
  presetSettings: ComfyUILoraPresetSettings;
  loraOptions: TextOption[];
  isLoadingLoras: boolean;
  /** ComfyUI 地址，用于向 LoRA Manager 拉取触发词 */
  comfyuiUrl: string;
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
/** 正在单条拉取触发词的 LoRA 条目 ID */
const fetchingTriggerWordIds = ref<ReadonlySet<string>>(new Set());
/** 进行中的批量拉取任务数（批量添加与批量获取可能重叠） */
const bulkTriggerWordFetchCount = ref(0);
/** 批量拉取触发词进行中 */
const isFetchingTriggerWordsBulk = computed(() => bulkTriggerWordFetchCount.value > 0);
/** 「更多」菜单打开中的条目 ID 与 Popover 实例 */
const moreMenuIds = ref<ReadonlySet<string>>(new Set());
const moreMenuRefs = new Map<string, { toggle: (event: Event) => void; hide: () => void }>();

/** 预览图浮层当前展示的条目 ID（同时只开一个，null 表示关闭） */
const previewLoraId = ref<string | null>(null);
/** 预览图浮层实例 */
let previewPopoverRef: { toggle: (event: Event) => void; hide: () => void } | null = null;
/** 预览图地址缓存（LoRA 名称 → 完整地址 / 错误信息 / 无图标记，避免重复请求） */
const previewUrlCache = new Map<string, string | { error: string } | null>();
/** 预览图浮层当前展示的内容状态 */
const previewState = ref<LoraPreviewState>({ status: 'loading' });

/** 预览图浮层内容状态 */
type LoraPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; imageFailed: boolean }
  | { status: 'missing'; message: string };

/**
 * 打开/关闭预览图浮层
 * @param id LoRA 条目 ID
 * @param name LoRA 名称
 * @param event 触发事件（传给 Popover 定位）
 */
async function togglePreview(id: string, name: string, event: Event): Promise<void> {
  if (previewLoraId.value === id) {
    closePreview();
    return;
  }
  closePreview();
  closeAllMoreMenus();
  previewLoraId.value = id;
  nextTick(() => previewPopoverRef?.toggle(event));
  await loadLoraPreview(id, name);
}

/**
 * 关闭预览图浮层
 */
function closePreview(): void {
  if (!previewLoraId.value) return;
  previewPopoverRef?.hide();
  previewLoraId.value = null;
}

/**
 * 登记/注销预览图 Popover 实例（模板 ref 回调）
 * @param el Popover 实例或 null（卸载）
 */
function setPreviewPopoverRef(el: unknown): void {
  previewPopoverRef = el ? (el as { toggle: (event: Event) => void; hide: () => void }) : null;
}

/**
 * 加载 LoRA 预览图（带缓存，失败结果同样缓存避免重复请求）
 * @param id 发起加载的 LoRA 条目 ID（用于丢弃迟到响应）
 * @param name LoRA 名称
 */
async function loadLoraPreview(id: string, name: string): Promise<void> {
  const key = name.trim();
  if (!key) {
    previewState.value = { status: 'missing', message: '未选择 LoRA' };
    return;
  }

  const cached = previewUrlCache.get(key);
  if (cached !== undefined) {
    applyPreviewCache(cached);
    return;
  }

  previewState.value = { status: 'loading' };
  try {
    const url = await fetchComfyUILoraPreviewUrl(props.comfyuiUrl, key);
    previewUrlCache.set(key, url);
    // 等待期间浮层可能已被关闭或切换到其他条目，迟到响应直接丢弃
    if (previewLoraId.value === id) applyPreviewCache(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取预览图失败';
    previewUrlCache.set(key, { error: message });
    if (previewLoraId.value === id) previewState.value = { status: 'missing', message };
    console.error('[ComfyUILoraPresetPanel]', error);
  }
}

/**
 * 把缓存值应用到预览浮层状态
 * @param cached 缓存的预览结果（地址 / 无图 / 错误）
 */
function applyPreviewCache(cached: string | { error: string } | null): void {
  if (typeof cached === 'string') previewState.value = { status: 'ready', url: cached, imageFailed: false };
  else if (cached === null) previewState.value = { status: 'missing', message: '该 LoRA 暂无预览图' };
  else previewState.value = { status: 'missing', message: cached.error };
}

/**
 * 预览图 <img> 加载失败（缓存地址指向的文件已不存在等）
 */
function onPreviewImageError(): void {
  if (previewState.value.status === 'ready') previewState.value = { ...previewState.value, imageFailed: true };
}

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
 * 打开/关闭「更多」菜单
 * @param id LoRA 条目 ID
 * @param event 触发事件（传给 Popover 定位）
 */
function toggleMoreMenu(id: string, event: Event): void {
  if (moreMenuIds.value.has(id)) {
    moreMenuRefs.get(id)?.hide();
    return;
  }
  closeAllMoreMenus();
  closePreview();
  const next = new Set(moreMenuIds.value);
  next.add(id);
  moreMenuIds.value = next;
  nextTick(() => moreMenuRefs.get(id)?.toggle(event));
}

/**
 * 收起全部「更多」菜单
 */
function closeAllMoreMenus(): void {
  moreMenuRefs.forEach(menu => menu.hide());
  moreMenuIds.value = new Set();
}

/**
 * 「更多」菜单项点击：先收起菜单再执行动作
 * @param id LoRA 条目 ID
 * @param action 动作
 */
function onMoreAction(id: string, action: () => void): void {
  moreMenuRefs.get(id)?.hide();
  closeAllMoreMenus();
  action();
}

/**
 * 登记 Popover 实例（模板 ref 回调）
 * @param id LoRA 条目 ID
 * @param el Popover 实例或 null（卸载）
 */
function setMoreMenuRef(id: string, el: unknown): void {
  if (el) moreMenuRefs.set(id, el as { toggle: (event: Event) => void; hide: () => void });
  else moreMenuRefs.delete(id);
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
 * 从 LoRA Manager 拉取单个 LoRA 的触发词，并与现有触发词合并（不覆盖手填内容）
 * @param id LoRA 条目 ID
 */
async function fetchTriggerWords(id: string): Promise<void> {
  const lora = activePreset.value?.loras.find(item => item.id === id);
  if (!lora?.name.trim() || fetchingTriggerWordIds.value.has(id)) return;
  if (!requireComfyUIUrl()) return;

  setFetchingTriggerWords(id, true);
  try {
    const words = await fetchComfyUILoraTriggerWords(props.comfyuiUrl, lora.name);
    if (!words.length) {
      toastr.info('LoRA Manager 没有记录该 LoRA 的触发词');
      return;
    }
    // 等待期间用户可能改过这一行，重新读取当前值再合并
    const current = activePreset.value?.loras.find(item => item.id === id);
    if (!current) return;
    const merged = dedupeTriggerWords([...current.triggerWords, ...words]);
    if (merged.length === current.triggerWords.length) {
      toastr.info('触发词已是最新');
      return;
    }
    updateLora(id, { triggerWords: merged });
    toastr.success(`已获取 ${words.length} 个触发词`);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : '获取触发词失败');
    console.error('[ComfyUILoraPresetPanel]', error);
  } finally {
    setFetchingTriggerWords(id, false);
  }
}

/**
 * 为当前分组内尚未填写触发词的 LoRA 批量拉取触发词（已填写的条目不动）
 */
async function fetchMissingTriggerWords(): Promise<void> {
  const preset = activePreset.value;
  if (!preset || isFetchingTriggerWordsBulk.value) return;
  if (!requireComfyUIUrl()) return;

  const targets = preset.loras.filter(lora => lora.name.trim() && !lora.triggerWords.length);
  if (!targets.length) {
    toastr.info('当前分组内已选 LoRA 都填过触发词了');
    return;
  }
  await fetchTriggerWordsInto(
    preset.id,
    targets.map(lora => lora.name),
  );
}

/**
 * 批量拉取指定 LoRA 的触发词，并写入仍为空的条目
 * @param presetId 预设组 ID
 * @param names 参与拉取的 LoRA 名称列表
 */
async function fetchTriggerWordsInto(presetId: string, names: readonly string[]): Promise<void> {
  bulkTriggerWordFetchCount.value += 1;
  try {
    const result = await fetchComfyUILoraTriggerWordsBatch(props.comfyuiUrl, names);
    const filled = applyFetchedTriggerWords(presetId, result.triggerWords);
    reportTriggerWordsBatch(filled, names.length, result);
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : '批量获取触发词失败');
    console.error('[ComfyUILoraPresetPanel]', error);
  } finally {
    bulkTriggerWordFetchCount.value -= 1;
  }
}

/**
 * 把批量拉取到的触发词写入仍为空的 LoRA 条目（一次性提交，避免多次 emit）
 * @param presetId 预设组 ID
 * @param fetched LoRA 名称到触发词的映射
 * @returns 实际写入的条目数
 */
function applyFetchedTriggerWords(presetId: string, fetched: ReadonlyMap<string, string[]>): number {
  const preset = props.presetSettings.presets.find(item => item.id === presetId);
  if (!preset) return 0;

  let filled = 0;
  const loras = preset.loras.map(lora => {
    const words = fetched.get(lora.name.trim());
    if (!words?.length || lora.triggerWords.length) return lora;
    filled += 1;
    return { ...lora, triggerWords: [...words] };
  });
  if (filled) updatePreset(presetId, () => ({ ...preset, loras }));
  return filled;
}

/**
 * 汇总批量拉取结果并提示（失败只报首条原因，避免刷屏）
 * @param filled 实际写入触发词的条目数
 * @param total 参与拉取的条目数
 * @param result 批量拉取结果
 */
function reportTriggerWordsBatch(
  filled: number,
  total: number,
  result: ComfyUILoraTriggerWordsBatchResult,
): void {
  const failed = result.failures.length;
  const firstFailure = result.failures[0]?.message;
  if (failed === total && firstFailure) {
    toastr.error(firstFailure);
    return;
  }
  if (filled) toastr.success(`已为 ${filled} / ${total} 个 LoRA 填入触发词`);
  const missing = total - filled - failed;
  if (missing > 0) toastr.info(`${missing} 个 LoRA 在 LoRA Manager 中没有触发词记录`);
  if (failed) toastr.warning(`${failed} 个 LoRA 获取失败：${firstFailure ?? '未知原因'}`);
}

/**
 * 切换单条触发词拉取中的状态
 * @param id LoRA 条目 ID
 * @param fetching 是否进行中
 */
function setFetchingTriggerWords(id: string, fetching: boolean): void {
  const next = new Set(fetchingTriggerWordIds.value);
  if (fetching) next.add(id);
  else next.delete(id);
  fetchingTriggerWordIds.value = next;
}

/**
 * 校验 ComfyUI 地址是否已填写
 * @returns 是否可以发起请求
 */
function requireComfyUIUrl(): boolean {
  if (props.comfyuiUrl.trim()) return true;
  toastr.warning('请先填写 ComfyUI URL');
  return false;
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
 * @param shouldFetchTriggerWords 添加后是否自动拉取触发词
 */
async function addLorasBulk(names: string[], shouldFetchTriggerWords: boolean): Promise<void> {
  const preset = activePreset.value;
  if (!preset || !names.length) return;
  updatePreset(preset.id, current => ({
    ...current,
    loras: [...current.loras, ...names.map(name => createComfyUILoraSetting(uuidv4(), { name, enabled: false }))],
  }));
  toastr.success(`已批量添加 ${names.length} 个 LoRA（默认禁用）`);

  if (!shouldFetchTriggerWords) return;
  if (!requireComfyUIUrl()) return;
  // 等新条目随 props 回流后再回填触发词
  await nextTick();
  await fetchTriggerWordsInto(preset.id, names);
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
