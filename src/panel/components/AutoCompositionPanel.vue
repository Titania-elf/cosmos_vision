<template>
  <CollapsiblePanelItem title="自动构图" :collapsed="collapsed" @toggle="collapsed = !collapsed">
    <template #actions>
      <CvMiniToggleSwitch v-model="config.enabled" aria-label="启用自动构图" />
    </template>
    <section class="flex flex-col gap-(--cv-space-5xl)">
      <div class="cv-field-hint">
        开启后，提示词 LLM
        在同一次回复中补充画面方向，并让提示词与构图一致，不会额外调用模型。方向缺失或无效时沿用当前尺寸。
      </div>
      <label class="cv-field">
        <span>构图规则</span>
        <CvExpandableTextarea v-model="config.prompt" :rows="7" />
        <div class="cv-field-hint">
          自定义规则保留固定方向输出：JSON 顶层 orientation 为 portrait（竖图）、landscape（横图）或 square（方图）。
        </div>
      </label>
      <div>
        <CvMiniButton
          label="恢复默认规则"
          icon="fa-solid fa-arrows-rotate"
          @click="config.prompt = DEFAULT_IMAGE_COMPOSITION_PROMPT"
        />
      </div>
      <label class="cv-field">
        <span>尺寸模式</span>
        <SelectButton
          v-model="config.sizeMode"
          :options="sizeModeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          aria-label="自动构图尺寸模式"
          fluid
        />
      </label>
      <div v-if="config.sizeMode === 'presets'" class="flex flex-col gap-(--cv-space-xl)">
        <div class="cv-field-hint">为每种方向分别设置尺寸，边长按 64 的倍数保存，范围为 64–4096。</div>
        <div v-if="settings.imageSource === 'novelai'" class="cv-field-hint">
          NovelAI 的边长范围为 64–2048，超出范围时沿用当前尺寸。
        </div>
        <div v-for="direction in directionOptions" :key="direction.value" class="cv-field">
          <span>{{ direction.label }}</span>
          <div class="grid grid-cols-2 gap-(--cv-space-lg)">
            <label class="cv-field">
              <span>宽度</span>
              <InputNumber
                :model-value="config.sizes[direction.value].width"
                :aria-label="`${direction.label}宽度`"
                :min="64"
                :max="4096"
                :step="64"
                :use-grouping="false"
                show-buttons
                fluid
                @update:model-value="value => setDimension(direction.value, 'width', value)"
              />
            </label>
            <label class="cv-field">
              <span>高度</span>
              <InputNumber
                :model-value="config.sizes[direction.value].height"
                :aria-label="`${direction.label}高度`"
                :min="64"
                :max="4096"
                :step="64"
                :use-grouping="false"
                show-buttons
                fluid
                @update:model-value="value => setDimension(direction.value, 'height', value)"
              />
            </label>
          </div>
        </div>
      </div>
      <div v-else class="cv-field-hint">
        根据当前尺寸交换宽高：竖图使用短边 × 长边，横图使用长边 × 短边；方图以当前像素面积的平方根作为边长，取最接近的
        64 倍数。 当前尺寸为方形时，横竖方向都保持该方形尺寸；可切换到方向预设尺寸。
        <template v-if="swapPreview">
          当前 {{ swapPreview.width }} × {{ swapPreview.height }}，方图为 {{ swapPreview.square }} ×
          {{ swapPreview.square }}。
        </template>
      </div>
      <div v-if="settings.imageSource === 'comfyui'" class="flex flex-col gap-(--cv-space-xl)">
        <label class="cv-field">
          <span>ComfyUI 尺寸目标 · {{ activeWorkflowPreset?.name || '当前工作流' }}</span>
          <Select
            v-model="selectedTargetKey"
            :options="targetOptions"
            option-label="label"
            option-value="value"
            option-disabled="disabled"
            :disabled="!activeWorkflowPreset"
            aria-label="ComfyUI 自动构图尺寸目标"
            fluid
          />
        </label>
        <div class="cv-field-hint">目标按工作流预设保存。自动选择仅在当前工作流只有一个可写尺寸目标时生效。</div>
        <div v-if="targetHint" class="cv-field-hint" role="status">{{ targetHint }}</div>
      </div>
    </section>
  </CollapsiblePanelItem>
</template>

<script setup lang="ts">
import { DEFAULT_IMAGE_COMPOSITION_PROMPT, type ImageOrientation } from '@/constants/image-composition';
import { parseComfyUIWorkflow } from '@/services/comfyui/parse';
import { listResolutionTargets } from '@/services/comfyui/resolution-combos';
import { getActiveComfyUIWorkflowPreset } from '@/services/comfyui/workflow-presets';
import { useSettingsStore } from '@/store/settings';
import CollapsiblePanelItem from './CollapsiblePanelItem.vue';
import CvExpandableTextarea from './CvExpandableTextarea.vue';
import CvMiniButton from './CvMiniButton.vue';
import CvMiniToggleSwitch from './CvMiniToggleSwitch.vue';

const { settings } = useSettingsStore();
const config = computed(() => settings.promptLlm.autoComposition);
const collapsed = ref(true);
const sizeModeOptions = [
  { label: '方向预设尺寸', value: 'presets' },
  { label: '交换当前宽高', value: 'swap' },
];
const directionOptions: { label: string; value: ImageOrientation }[] = [
  { label: '竖图', value: 'portrait' },
  { label: '横图', value: 'landscape' },
  { label: '方图', value: 'square' },
];

const activeWorkflowPreset = computed(() => {
  try {
    return getActiveComfyUIWorkflowPreset(settings.comfyui.workflowPresets);
  } catch {
    return undefined;
  }
});

const workflowResolution = computed(() => {
  const preset = activeWorkflowPreset.value;
  if (!preset) return { targets: [], error: '请先添加 ComfyUI 工作流预设。' };
  try {
    return { targets: listResolutionTargets(parseComfyUIWorkflow(preset.workflowJson)), error: '' };
  } catch (error) {
    return { targets: [], error: error instanceof Error ? error.message : '当前工作流无法读取尺寸。' };
  }
});

const selectedTargetKey = computed({
  get() {
    const preset = activeWorkflowPreset.value;
    return preset ? config.value.comfyuiTargets[preset.id] || '' : '';
  },
  set(value: string) {
    const preset = activeWorkflowPreset.value;
    if (!preset) return;
    if (value) config.value.comfyuiTargets[preset.id] = value;
    else delete config.value.comfyuiTargets[preset.id];
  },
});

const targetOptions = computed(() => {
  const options = [
    { label: '自动选择（仅一个尺寸目标时）', value: '', disabled: false },
    ...workflowResolution.value.targets.map(target => ({
      label: `#${target.nodeId} ${target.title} · ${target.width} × ${target.height} · ${target.detail}`,
      value: target.key,
      disabled: false,
    })),
  ];
  if (selectedTargetKey.value && !options.some(option => option.value === selectedTargetKey.value)) {
    options.push({ label: '原尺寸目标已失效，请重新选择', value: selectedTargetKey.value, disabled: true });
  }
  return options;
});

const targetHint = computed(() => {
  const { targets, error } = workflowResolution.value;
  if (error) return error;
  if (!targets.length) return '当前工作流没有可写的宽高目标，生成时沿用工作流尺寸。';
  if (selectedTargetKey.value && !targets.some(target => target.key === selectedTargetKey.value)) {
    return '已保存的尺寸目标不在当前工作流中，生成时沿用工作流尺寸。';
  }
  if (!selectedTargetKey.value && targets.length > 1) {
    return `当前工作流有 ${targets.length} 个尺寸目标，请选定一个；未选定时沿用工作流尺寸。`;
  }
  return '';
});

const swapPreview = computed(() => {
  let size: { width: number; height: number } | undefined;
  if (settings.imageSource === 'novelai') size = settings.novelai;
  else {
    const targets = workflowResolution.value.targets;
    size = selectedTargetKey.value
      ? targets.find(target => target.key === selectedTargetKey.value)
      : targets.length === 1
        ? targets[0]
        : undefined;
  }
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return undefined;
  }
  return {
    width: size.width,
    height: size.height,
    square: normalizeDimension(Math.sqrt(size.width * size.height)),
  };
});

/** 把编辑值限制在支持范围内，并保持对应方向的宽高关系。 */
function setDimension(orientation: ImageOrientation, axis: 'width' | 'height', value: number | null): void {
  if (value === null || !Number.isFinite(value)) return;
  const size = config.value.sizes[orientation];
  size[axis] = normalizeDimension(value);
  if (orientation === 'square') {
    size.width = size.height = size[axis];
    return;
  }
  const shortAxis = orientation === 'portrait' ? 'width' : 'height';
  const longAxis = orientation === 'portrait' ? 'height' : 'width';
  if (size[shortAxis] < size[longAxis]) return;
  if (axis === shortAxis) {
    size[shortAxis] = Math.min(4032, size[shortAxis]);
    size[longAxis] = size[shortAxis] + 64;
  } else {
    size[longAxis] = Math.max(128, size[longAxis]);
    size[shortAxis] = size[longAxis] - 64;
  }
}

function normalizeDimension(value: number): number {
  return Math.max(64, Math.min(4096, Math.round(value / 64) * 64));
}
</script>
