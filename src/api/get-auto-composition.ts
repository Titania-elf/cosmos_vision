import type { ApiAutoCompositionScheme, GetAutoCompositionResult } from '@/api/types';
import type { ImageOrientation } from '@/constants/image-composition';
import { resolveComfyUIImageComposition } from '@/services/comfyui/image-composition';
import { buildCompositionInstruction, resolveNovelAIImageComposition } from '@/services/image-composition';
import { useSettingsStore } from '@/store/settings';

const ORIENTATIONS: Array<{ orientation: ImageOrientation; label: string }> = [
  { orientation: 'portrait', label: '竖图' },
  { orientation: 'landscape', label: '横图' },
  { orientation: 'square', label: '方图' },
];

/**
 * 查询当前已保存配置下可使用的自动构图方案（不请求 LLM、不生图、不修改设置）。
 * 与 generateImage 共用构图解析器；结果是配置级预览，后续生图仍以调用时的配置为准。
 * @returns 开关状态、当前图源、可用方案与构图规则
 */
export async function getAutoComposition(): Promise<GetAutoCompositionResult> {
  const { savedSettings } = useSettingsStore();
  const { imageSource } = savedSettings;
  const compositionSettings = savedSettings.promptLlm.autoComposition;
  const schemes: ApiAutoCompositionScheme[] = [];
  if (compositionSettings.enabled) {
    for (const { orientation, label } of ORIENTATIONS) {
      const composition =
        imageSource === 'comfyui'
          ? resolveComfyUIImageComposition(savedSettings.comfyui, compositionSettings, orientation).composition
          : resolveNovelAIImageComposition(compositionSettings, orientation, savedSettings.novelai);
      if (composition) {
        schemes.push({ orientation, label, width: composition.width, height: composition.height });
      }
    }
  }
  const instruction = schemes.length
    ? `${buildCompositionInstruction(compositionSettings)}\n\n当前可用构图方案：${schemes
        .map(scheme => `${scheme.orientation}（${scheme.label}，${scheme.width}×${scheme.height}）`)
        .join('、')}。本次 orientation 只能从上述可用方案中选择；尺寸仅供理解画幅，不要输出尺寸字段。`
    : '';
  return {
    enabled: compositionSettings.enabled,
    available: schemes.length > 0,
    imageSource,
    sizeMode: compositionSettings.sizeMode,
    schemes,
    instruction,
  };
}
