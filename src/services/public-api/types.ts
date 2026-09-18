/** Cosmos Vision 同页公开接口 1.0；调用方不需要导入任何运行时模块。 */
export type ImageSource = 'novelai' | 'comfyui';

export interface CharacterPrompt {
  positivePrompt: string;
  negativePrompt: string;
  /** 连续归一化坐标，范围 0–1。 */
  position: { x: number; y: number };
}

export interface ImagePrompts {
  /** 已合并画风、质量、画师串等预设的最终提示词。 */
  positivePrompt: string;
  negativePrompt: string;
  characterPrompts: CharacterPrompt[];
}

export interface SceneSelection {
  summary: string;
  /** theaterText 中连续、逐字一致的原文。 */
  sourceExcerpt: string;
}

export interface PromptDraft {
  version: 1;
  imageSource: ImageSource;
  /** NovelAI 模型 ID，或不含配置明文的 ComfyUI 工作流标识。 */
  model: string;
  scene: SceneSelection;
  prompts: ImagePrompts;
}

export interface RequestControl {
  requestId: string;
  signal?: AbortSignal;
  onProgress?: (event: {
    requestId: string;
    stage: 'queued' | 'analyzing' | 'generating' | 'downloading';
    message?: string;
    fraction?: number;
  }) => void;
}

export interface Capabilities {
  apiVersion: '1.0';
  ready: boolean;
  enabled: boolean;
  reason?: string;
  defaultImageSource: ImageSource;
  features: { theaterPrompt: boolean; providedContext: boolean };
  limits: { maxTextChars: number; maxImages: number };
  imageSources: Array<{
    id: ImageSource;
    label: string;
    ready: boolean;
    reason?: string;
    model: string;
  }>;
}

export interface PreparePromptRequest {
  mode: 'theater';
  imageSource: ImageSource;
  presetId?: string;
  theaterText: string;
  context: {
    mode: 'provided';
    source: { client: 'titania-theater'; sceneId: string };
    participants: string;
    history: string[];
  };
  specialRequest: string;
  previousScenes?: SceneSelection[];
}

export interface GenerateRequest {
  draft: PromptDraft;
  count: number;
}

export interface GeneratedImage {
  blob: Blob;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  seed?: number | string;
}

export interface GenerateResult {
  requestId: string;
  draft: PromptDraft;
  images: GeneratedImage[];
}

export interface CosmosVisionPublicApi {
  apiVersion: '1.0';
  getCapabilities(): Capabilities | Promise<Capabilities>;
  preparePrompt(request: PreparePromptRequest, control: RequestControl): Promise<PromptDraft>;
  generate(request: GenerateRequest, control: RequestControl): Promise<GenerateResult>;
}

declare global {
  interface Window {
    CosmosVision?: CosmosVisionPublicApi;
  }
}
