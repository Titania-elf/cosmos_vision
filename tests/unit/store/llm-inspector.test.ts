import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { eventSource } from '@sillytavern/script';
import { useLlmInspectorStore } from '@/store/llm-inspector';
import type { LlmInspectorRequestSnapshot } from '@/services/prompt-llm/llm-inspector';

/** 构造请求快照 */
function buildSnapshot(id: string, overrides: Partial<LlmInspectorRequestSnapshot> = {}): LlmInspectorRequestSnapshot {
  return {
    id,
    label: `段落 ${id}`,
    startedAt: 1000,
    prompts: [{ role: 'system', content: '你是提示词生成器' }, { role: 'user', content: '生成图片' }],
    model: 'test-model',
    endpoint: '代理预设 测试',
    accountName: '账号一',
    streamEnabled: true,
    ...overrides,
  };
}

describe('useLlmInspectorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useLlmInspectorStore().start();
  });

  it('记录请求快照并进入 running 状态', () => {
    const store = useLlmInspectorStore();
    store.recordRequest(buildSnapshot('gen-1'));
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({
      id: 'gen-1',
      status: 'running',
      thinkingText: '',
      contentText: '',
    });
    expect(store.hasRunningSession).toBe(true);
  });

  it('多会话新 → 旧排序且超过上限时淘汰最旧记录', () => {
    const store = useLlmInspectorStore();
    for (let index = 0; index < 55; index += 1) {
      store.recordRequest(buildSnapshot(`gen-${index}`, { startedAt: index }));
    }
    expect(store.sessions).toHaveLength(50);
    expect(store.sessions[0]!.id).toBe('gen-54');
    expect(store.sessions.at(-1)!.id).toBe('gen-5');
  });

  it('同一会话故障转移重试时更新请求侧信息并保留已流出响应', () => {
    const store = useLlmInspectorStore();
    store.recordRequest(buildSnapshot('gen-1', { accountName: '账号一' }));
    eventSource.emit('js_stream_token_received_fully', '部分响应', 'gen-1');
    expect(store.sessions[0]!.contentText).toBe('部分响应');

    store.recordRequest(buildSnapshot('gen-1', { accountName: '账号二', model: 'backup-model' }));
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0]).toMatchObject({ accountName: '账号二', model: 'backup-model' });
    // 保留已流出的响应文本
    expect(store.sessions[0]!.contentText).toBe('部分响应');
  });

  it('流式事件按 generation_id 过滤：他家请求与已结束会话不更新', () => {
    const store = useLlmInspectorStore();
    store.recordRequest(buildSnapshot('gen-1'));
    eventSource.emit('js_stream_token_received_fully', '外部请求内容', 'other-extension');
    expect(store.sessions[0]!.contentText).toBe('');

    eventSource.emit('js_stream_token_received_fully', '自家内容', 'gen-1');
    expect(store.sessions[0]!.contentText).toBe('自家内容');

    eventSource.emit('js_generation_ended', '最终全文', 'gen-1');
    expect(store.sessions[0]!.status).toBe('completed');
    // ended 写入最终全文；之后到达的迟到流式分片不再更新
    expect(store.sessions[0]!.contentText).toBe('最终全文');
    eventSource.emit('js_stream_token_received_fully', '迟到分片', 'gen-1');
    expect(store.sessions[0]!.contentText).toBe('最终全文');
  });

  it('流式增量分离思考与正文', () => {
    const store = useLlmInspectorStore();
    store.recordRequest(buildSnapshot('gen-1'));
    eventSource.emit('js_stream_token_received_fully', '<thinking>推理中', 'gen-1');
    expect(store.sessions[0]!.thinkingText).toBe('推理中');
    expect(store.sessions[0]!.contentText).toBe('');

    eventSource.emit('js_stream_token_received_fully', '<thinking>推理完成</thinking>1girl, solo', 'gen-1');
    expect(store.sessions[0]!.thinkingText).toBe('推理完成');
    expect(store.sessions[0]!.contentText).toBe('1girl, solo');
  });

  it('ended 事件完成会话并写入最终全文（非流式路径）', () => {
    const store = useLlmInspectorStore();
    store.recordRequest(buildSnapshot('gen-1', { streamEnabled: false }));
    eventSource.emit('js_generation_ended', '{"positivePrompt": "1girl"}', 'gen-1');
    expect(store.sessions[0]).toMatchObject({
      status: 'completed',
      contentText: '{"positivePrompt": "1girl"}',
    });
    expect(store.hasRunningSession).toBe(false);
  });

  it('markSucceeded / markFailed 更新状态与账号信息', () => {
    const store = useLlmInspectorStore();
    store.recordRequest(buildSnapshot('gen-1'));
    store.markSucceeded('gen-1', '完整响应', '账号二');
    expect(store.sessions[0]).toMatchObject({
      status: 'completed',
      contentText: '完整响应',
      accountName: '账号二',
      finishedAt: expect.any(Number),
    });

    store.recordRequest(buildSnapshot('gen-2'));
    store.markFailed('gen-2', new Error('请求超时'));
    expect(store.sessions[0]).toMatchObject({
      status: 'failed',
      error: '请求超时',
    });
    // 未知会话 ID 静默忽略
    expect(() => store.markFailed('missing', new Error('x'))).not.toThrow();
  });

  it('start 订阅后 stop 解除订阅，clearSessions 清空记录', () => {
    const store = useLlmInspectorStore();
    store.start();
    store.recordRequest(buildSnapshot('gen-1'));
    store.stop();
    // stop 后事件不再写入
    eventSource.emit('js_generation_ended', '结束', 'gen-1');
    expect(store.sessions[0]!.status).toBe('running');

    store.clearSessions();
    expect(store.sessions).toHaveLength(0);
    expect(store.hasRunningSession).toBe(false);
  });
});
