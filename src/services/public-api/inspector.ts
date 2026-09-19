import type { PromptLlmSettings } from '@/constants/prompt-llm';
import {
  buildProvidedLlmInspectorSnapshot,
  buildTheaterLlmInspectorLabel,
} from '@/services/prompt-llm/llm-inspector';
import type { TavernHelperRolePrompt } from '@/services/tavern-helper/prompt-llm';
import { useLlmInspectorStore } from '@/store/llm-inspector';
import { describeProvidedLlm } from './llm';

/**
 * 监视记账一律尽力而为：设置面板尚未挂载（Pinia 未激活）或监视不可用时静默跳过，
 * 记录失败不得影响公开接口本身。
 * @param action 对监视 store 的写操作
 */
function withInspector(action: (store: ReturnType<typeof useLlmInspectorStore>) => void): void {
  try {
    action(useLlmInspectorStore());
  } catch {
    /* 监视不可用时跳过本次记录 */
  }
}

/**
 * 记录本次小剧场请求，供 Cosmos 的 LLM 请求监视查看
 * @param settings 提示词 LLM 配置
 * @param requestId 本次公开接口请求标识
 * @param theaterText 本次小剧场正文
 * @param messages 已组装待发送的指令
 */
export function recordTheaterLlmRequest(
  settings: PromptLlmSettings,
  requestId: string,
  theaterText: string,
  messages: TavernHelperRolePrompt[],
): void {
  withInspector(store =>
    store.recordRequest(
      buildProvidedLlmInspectorSnapshot(
        requestId,
        messages,
        describeProvidedLlm(settings),
        buildTheaterLlmInspectorLabel(theaterText),
      ),
    ),
  );
}

/**
 * 标记小剧场请求成功并写入模型返回全文
 * @param settings 提示词 LLM 配置
 * @param requestId 本次公开接口请求标识
 * @param rawText 模型原始响应
 */
export function recordTheaterLlmSuccess(
  settings: PromptLlmSettings,
  requestId: string,
  rawText: string,
): void {
  withInspector(store => store.markSucceeded(requestId, rawText, describeProvidedLlm(settings).accountName));
}

/**
 * 标记小剧场请求失败
 * @param requestId 本次公开接口请求标识
 * @param error 失败原因
 */
export function recordTheaterLlmFailure(requestId: string, error: unknown): void {
  withInspector(store => store.markFailed(requestId, error));
}
