/** 图片构图方向，由同一次提示词生成请求决定。 */
export type ImageOrientation = 'portrait' | 'landscape' | 'square';

export interface ImageCompositionSettings {
  enabled: boolean;
  sizeMode: 'presets' | 'swap';
  sizes: Record<ImageOrientation, { width: number; height: number }>;
  prompt: string;
  /** ComfyUI 工作流预设 ID 到尺寸目标 key；未指定时仅自动匹配唯一目标。 */
  comfyuiTargets: Record<string, string>;
}

/** 单次请求使用的构图与尺寸，避免并发请求共享临时设置。 */
export interface ImageCompositionSnapshot {
  orientation: ImageOrientation;
  width: number;
  height: number;
  targetKey?: string;
}

export const PROMPT_LLM_COMPOSITION_TOKEN = '{{composition}}';
export const DEFAULT_PROMPT_LLM_COMPOSITION_MESSAGE_ID = 'prompt-llm-auto-composition';

export const DEFAULT_IMAGE_COMPOSITION_PROMPT = `根据当前焦点场景，为本次画面选择最合适的构图方向，并让生成的提示词、镜头、人物位置和画面安排与该方向保持一致。
1. 以焦点段落中的实际动作、主体关系和环境为依据；历史上下文仅用于理解当前场景，不要用历史场景取代焦点场景。
2. portrait（竖图）：适合单人立姿、全身或纵向动作，以及需要上下空间的画面。
3. landscape（横图）：适合多人横向排列、对峙互动、横向动作、宽阔环境或需要左右空间的画面。
4. square（方图）：适合居中近景、半身、特写、对称或紧凑构图；不要固定偏向某个方向。
5. 用户本次特别要求优先；明确指定方向、镜头或人物安排时遵从，并在提示词中具体体现对应构图。
6. 保留原有正面、负面和人物提示词等输出格式要求，在同一个 JSON 输出对象的顶层补充 "orientation" 字段。该字段必须且只能为 "portrait"、"landscape"、"square" 中的一个字符串。不要把它放在人物数组或其他嵌套对象里，不要输出尺寸或额外的构图 JSON，也不要增加解释文本。`;

export const DEFAULT_IMAGE_COMPOSITION_SETTINGS: ImageCompositionSettings = {
  enabled: false,
  sizeMode: 'presets',
  sizes: {
    portrait: { width: 832, height: 1216 },
    landscape: { width: 1216, height: 832 },
    square: { width: 1024, height: 1024 },
  },
  prompt: DEFAULT_IMAGE_COMPOSITION_PROMPT,
  comfyuiTargets: {},
};
