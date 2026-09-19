import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import type { CosmosVisionSettings } from '@/constants/novelai';
import type { PreparePromptRequest, PromptDraft } from '@/services/public-api/types';

export const THEATER_TEXT = '清晨，林站在山顶看日出。\n夜晚，林和叶在雨中的车站重逢。';
export const LLM_RESULT = {
  scene: { summary: '两人在雨中的车站重逢。' },
  positivePrompt: '2people, rainy station, reunion',
  negativePrompt: 'blurry',
  characterPrompts: [{ positivePrompt: 'black hair, coat', negativePrompt: '', position: { x: 0, y: 1 } }],
};

export function makeSettings(): CosmosVisionSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.novelai.accounts[0]!, {
    apiKey: 'secret-novelai-token',
    url: 'https://images.example.test',
    enabled: true,
  });
  Object.assign(settings.promptLlm.accounts[0]!, {
    apiUrl: 'https://llm.example.test/v1',
    apiKey: 'secret-llm-token',
    model: 'test-llm',
    source: 'openai',
    enabled: true,
  });
  settings.comfyui.url = 'http://127.0.0.1:8188';
  settings.comfyui.workflowPresets = {
    activePresetId: 'workflow-a',
    presets: [
      {
        id: 'workflow-a',
        name: '测试工作流',
        favoriteNodeIds: [],
        workflowJson: JSON.stringify({
          '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model-a.safetensors' } },
          '2': {
            class_type: 'CLIPTextEncode',
            inputs: { clip: ['1', 1], text: '' },
            _meta: { cosmosVision: { promptBindings: { text: 'positive' } } },
          },
          '3': {
            class_type: 'CLIPTextEncode',
            inputs: { clip: ['1', 1], text: '' },
            _meta: { cosmosVision: { promptBindings: { text: 'negative' } } },
          },
          '4': {
            class_type: 'KSampler',
            inputs: {
              model: ['1', 0],
              positive: ['2', 0],
              negative: ['3', 0],
              latent_image: ['5', 0],
              steps: 20,
              cfg: 7,
              seed: 123,
            },
            _meta: { cosmosVision: { seedModes: { seed: 'fixed' } } },
          },
          '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 4 } },
          '6': { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['1', 2] } },
          '7': {
            class_type: 'SaveImage',
            inputs: { images: ['6', 0] },
            _meta: { cosmosVision: { imageOutput: true } },
          },
        }),
      },
    ],
  };
  return settings;
}

export function makeRequest(): PreparePromptRequest {
  return {
    mode: 'theater',
    imageSource: 'novelai',
    theaterText: THEATER_TEXT,
    context: {
      mode: 'provided',
      source: { client: 'titania-theater', sceneId: 'scene-a' },
      participants: '',
      history: [],
    },
    specialRequest: '',
  };
}

export function makeDraft(settings = makeSettings()): PromptDraft {
  return {
    version: 1,
    imageSource: 'novelai',
    model: settings.novelai.model,
    scene: structuredClone(LLM_RESULT.scene),
    prompts: {
      positivePrompt: 'edited prompt',
      negativePrompt: 'edited negative',
      characterPrompts: structuredClone(LLM_RESULT.characterPrompts),
    },
  };
}

/** 真正的 1×1 PNG；尺寸解码在 jsdom 测试中由浏览器解码器 mock 提供。 */
export function pngBlob(): Blob {
  const bytes = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),
    char => char.charCodeAt(0),
  );
  return new Blob([bytes], { type: 'image/png' });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
