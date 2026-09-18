import type { CosmosVisionSettings } from '@/constants/novelai';
import { PublicApiError, throwIfAborted } from './errors';
import { readGeneratedImage } from './images';
import { getProvidedLlmError, requestProvidedPrompt, snapshotProvidedLlmConfig } from './llm';
import { buildTheaterJsonSchema, buildTheaterMessages, extractTheaterResult } from './prompt';
import { finalizeImagePrompts, generatePublicImage, readImageSourceStatus, requireImageSource } from './providers';
import { PublicTaskRunner } from './tasks';
import type { Capabilities, CosmosVisionPublicApi } from './types';
import {
  MAX_IMAGES,
  MAX_TEXT_CHARS,
  validateDraft,
  validateGenerateRequest,
  validatePrepareRequest,
} from './validation';

export type SettingsSource = () => CosmosVisionSettings | undefined;

/** 与 Vue 挂载、聊天 DOM、人物 store 及图库完全独立。 */
export function createCosmosVisionPublicApi(getSettings: SettingsSource): CosmosVisionPublicApi {
  const runner = new PublicTaskRunner();

  function snapshot(): CosmosVisionSettings {
    const settings = getSettings();
    if (!settings) throw new PublicApiError('NOT_READY', 'Cosmos Vision 尚未初始化完成。');
    if (!settings.enabled) throw new PublicApiError('DISABLED', 'Cosmos Vision 已关闭，请先启用插件。');
    return JSON.parse(JSON.stringify(settings)) as CosmosVisionSettings;
  }

  function getCapabilities(): Capabilities {
    const settings = getSettings();
    const initialized = Boolean(settings);
    const enabled = settings?.enabled ?? false;
    const imageSources = settings
      ? [readImageSourceStatus(settings, 'novelai'), readImageSourceStatus(settings, 'comfyui')]
      : [
          { id: 'novelai' as const, label: 'NovelAI', ready: false, model: '' },
          { id: 'comfyui' as const, label: 'ComfyUI', ready: false, model: '' },
        ];
    const llmError = settings && getProvidedLlmError(settings.promptLlm);
    const reason = !initialized ? 'Cosmos Vision 尚未初始化完成。' : !enabled ? 'Cosmos Vision 已关闭。' : llmError;
    return {
      apiVersion: '1.0',
      ready: initialized,
      enabled,
      ...(reason ? { reason } : {}),
      defaultImageSource: settings?.imageSource ?? 'novelai',
      features: { theaterPrompt: true, providedContext: true },
      limits: { maxTextChars: MAX_TEXT_CHARS, maxImages: MAX_IMAGES },
      imageSources,
    };
  }

  return {
    apiVersion: '1.0',
    getCapabilities,
    preparePrompt(input, control) {
      return runner.run(control, () => {
        const settings = snapshot();
        const request = validatePrepareRequest(input);
        const provider = requireImageSource(settings, request.imageSource);
        const llmConfig = snapshotProvidedLlmConfig(settings.promptLlm);
        return {
          timeoutSeconds: settings.promptLlm.timeout,
          async execute(task) {
            const messages = await buildTheaterMessages(settings, request, provider.model);
            throwIfAborted(task.signal);
            task.progress('analyzing');
            throwIfAborted(task.signal);
            const rawText = await requestProvidedPrompt(
              llmConfig,
              messages,
              settings.promptLlm.preferJsonSchemaExtraction ? buildTheaterJsonSchema() : undefined,
              task.signal,
            );
            throwIfAborted(task.signal);
            const result = extractTheaterResult(rawText, request.theaterText);
            return validateDraft({
              version: 1,
              imageSource: request.imageSource,
              model: provider.model,
              scene: result.scene,
              prompts: finalizeImagePrompts(settings, request.imageSource, result.prompts),
            });
          },
        };
      });
    },
    generate(input, control) {
      return runner.run(control, () => {
        const settings = snapshot();
        const request = validateGenerateRequest(input);
        const provider = requireImageSource(settings, request.draft.imageSource);
        if (provider.model !== request.draft.model)
          throw new PublicApiError('CONFIG_CHANGED', '图像模型或工作流已改变，请重新分析小剧场以准备兼容的提示词。');
        return {
          timeoutSeconds: settings[request.draft.imageSource].timeout,
          async execute(task) {
            task.progress('generating');
            throwIfAborted(task.signal);
            const generated = await generatePublicImage(settings, request.draft, task);
            throwIfAborted(task.signal);
            if (generated.blobs.length !== request.count)
              throw new PublicApiError('INVALID_RESPONSE', '图像服务未返回请求数量的图片。');
            const images = await Promise.all(
              generated.blobs.map(blob => readGeneratedImage(blob, task.signal, generated.seed)),
            );
            throwIfAborted(task.signal);
            return { requestId: task.requestId, draft: request.draft, images };
          },
        };
      });
    },
  };
}
