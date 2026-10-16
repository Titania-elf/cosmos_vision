import type { ComfyUISettings } from '@/constants/comfyui';
import type {
  ImageCompositionSettings,
  ImageCompositionSnapshot,
  ImageOrientation,
} from '@/constants/image-composition';
import { resolveImageComposition } from '@/services/image-composition';
import { listResolutionTargets } from '@/services/comfyui/resolution-combos';
import { getActiveComfyUIWorkflowPreset } from '@/services/comfyui/workflow-presets';
import { parseComfyUIWorkflow } from '@/services/comfyui/parse';

/** 在请求前锁定工作流及尺寸目标，异步读取 LoRA 时切换面板不会串用尺寸。 */
export function resolveComfyUIImageComposition(
  settings: ComfyUISettings,
  compositionSettings: ImageCompositionSettings | undefined,
  orientation: ImageOrientation | undefined,
): { settings: ComfyUISettings; composition?: ImageCompositionSnapshot } {
  const requestSettings = {
    ...settings,
    workflowPresets: {
      activePresetId: settings.workflowPresets.activePresetId,
      presets: settings.workflowPresets.presets.map(preset => ({
        ...preset,
        favoriteNodeIds: [...preset.favoriteNodeIds],
      })),
    },
  };
  if (!compositionSettings?.enabled || !orientation) return { settings: requestSettings };
  try {
    const preset = getActiveComfyUIWorkflowPreset(requestSettings.workflowPresets);
    const targets = listResolutionTargets(parseComfyUIWorkflow(preset.workflowJson));
    const configuredKey = compositionSettings.comfyuiTargets[preset.id];
    const target = configuredKey
      ? targets.find(item => item.key === configuredKey)
      : targets.length === 1
        ? targets[0]
        : undefined;
    if (!target) return { settings: requestSettings };
    const composition = resolveImageComposition(compositionSettings, orientation, target);
    return {
      settings: requestSettings,
      ...(composition ? { composition: { ...composition, targetKey: target.key } } : {}),
    };
  } catch {
    // 工作流原有校验在请求构建时处理；构图不能让原本的生图额外失败。
    return { settings: requestSettings };
  }
}
