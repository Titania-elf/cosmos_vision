import { eventSource } from '@sillytavern/script';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { LlmInspectorRequestSnapshot } from '@/services/prompt-llm/llm-inspector';
import { splitThinkingContent } from '@/services/prompt-llm/thinking-stream-parser';

/** 会话保留上限（内存态，刷新页面即清空） */
const MAX_SESSIONS = 50;

/** TavernHelper 流式事件名（js_generation_started 对账靠快照侧，无需订阅） */
const STREAM_TOKEN_EVENT = 'js_stream_token_received_fully';
const GENERATION_ENDED_EVENT = 'js_generation_ended';

/** 监视会话状态 */
export type LlmInspectorSessionStatus = 'running' | 'completed' | 'failed';

/** 监视会话完整记录 */
export interface LlmInspectorSession extends LlmInspectorRequestSnapshot {
  status: LlmInspectorSessionStatus;
  /** 思考过程（含正文内联思考标签分离结果） */
  thinkingText: string;
  /** 正文（流式累积或最终全文） */
  contentText: string;
  finishedAt?: number;
  error?: string;
}

/**
 * LLM 请求监视 Store
 * 发送侧由 useInlineImageGeneration 通过钩子写入（仅内联生图）；
 * 响应侧订阅 TavernHelper 在 ST eventSource 上广播的流式事件，
 * 按 generation_id 过滤自家请求。内存态，不落盘。
 */
export const useLlmInspectorStore = defineStore('cosmos_vision_llm_inspector', () => {
  /** 会话记录（新 → 旧） */
  const sessions = ref<LlmInspectorSession[]>([]);
  /** 事件订阅是否已建立 */
  let subscribed = false;

  /** 是否存在进行中的会话 */
  const hasRunningSession = computed(() => sessions.value.some(session => session.status === 'running'));

  /**
   * 记录请求快照（每次账号尝试调用；多账号故障转移时更新请求侧信息）
   * @param snapshot 请求快照
   */
  function recordRequest(snapshot: LlmInspectorRequestSnapshot): void {
    const existing = findSessionIndex(snapshot.id);
    if (existing === -1) {
      sessions.value = [
        { ...snapshot, status: 'running' as const, thinkingText: '', contentText: '' },
        ...sessions.value,
      ].slice(0, MAX_SESSIONS);
      return;
    }
    // 故障转移重试：更新请求侧信息，保留已流出的响应文本
    sessions.value[existing] = {
      ...sessions.value[existing]!,
      ...snapshot,
      startedAt: snapshot.startedAt,
    };
  }

  /**
   * 标记会话成功（请求返回后调用；流式内容此前已由事件逐步写入）
   * @param id generation_id
   * @param rawText LLM 原始响应全文
   * @param accountName 实际成功的账号名
   */
  function markSucceeded(id: string, rawText: string, accountName: string): void {
    const session = findSession(id);
    if (!session) return;
    const { thinking, content } = splitThinkingContent(rawText);
    session.status = 'completed';
    session.finishedAt = Date.now();
    session.accountName = accountName;
    // ended 事件与钩子可能先后到达，取信息更全的一次
    if (thinking) session.thinkingText = thinking;
    if (content) session.contentText = content;
  }

  /**
   * 标记会话失败（全部账号尝试失败或请求异常）
   * @param id generation_id
   * @param error 失败原因
   */
  function markFailed(id: string, error: unknown): void {
    const session = findSession(id);
    if (!session) return;
    session.status = 'failed';
    session.finishedAt = Date.now();
    session.error = error instanceof Error ? error.message : String(error);
  }

  /**
   * 建立流式事件订阅（幂等；App 挂载时调用）
   */
  function start(): void {
    if (subscribed) return;
    subscribed = true;
    eventSource.on(STREAM_TOKEN_EVENT, handleStreamToken);
    eventSource.on(GENERATION_ENDED_EVENT, handleGenerationEnded);
  }

  /**
   * 解除订阅（App 卸载时调用）
   */
  function stop(): void {
    if (!subscribed) return;
    subscribed = false;
    eventSource.removeListener(STREAM_TOKEN_EVENT, handleStreamToken);
    eventSource.removeListener(GENERATION_ENDED_EVENT, handleGenerationEnded);
  }

  /**
   * 清空全部会话记录
   */
  function clearSessions(): void {
    sessions.value = [];
  }

  /**
   * 处理流式增量事件：按 generation_id 过滤自家请求并分离思考/正文
   * @param text 累积全文
   * @param generationId 请求标识
   */
  function handleStreamToken(text: string, generationId: string): void {
    const session = findSession(generationId);
    if (!session || session.status !== 'running') return;
    const { thinking, content } = splitThinkingContent(text);
    session.thinkingText = thinking;
    session.contentText = content;
  }

  /**
   * 处理生成结束事件：写入最终全文并标记完成
   * @param message 最终消息
   * @param generationId 请求标识
   */
  function handleGenerationEnded(message: string, generationId: string): void {
    const session = findSession(generationId);
    if (!session) return;
    if (session.status !== 'running') return;
    const { thinking, content } = splitThinkingContent(message);
    session.status = 'completed';
    session.finishedAt = Date.now();
    session.thinkingText = thinking || session.thinkingText;
    session.contentText = content || session.contentText;
  }

  /**
   * 查找会话下标
   * @param id generation_id
   */
  function findSessionIndex(id: string): number {
    return sessions.value.findIndex(session => session.id === id);
  }

  /**
   * 查找可变会话引用（ref 数组内对象为 reactive）
   * @param id generation_id
   */
  function findSession(id: string): LlmInspectorSession | undefined {
    return sessions.value.find(session => session.id === id);
  }

  return {
    sessions,
    hasRunningSession,
    recordRequest,
    markSucceeded,
    markFailed,
    start,
    stop,
    clearSessions,
  };
});
