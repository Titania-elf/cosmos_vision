import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentChatScope, isSameChatScope, listPastChats, readPastChatMetadata, type ChatScope } from '@/services/sillytavern/chats';

const state = vi.hoisted(() => ({
  chatId: 'current',
  context: { groupId: null as string | null, characterId: 0, characters: [{ avatar: 'Story.png' }] },
}));
vi.mock('@sillytavern/script', () => ({
  getCurrentChatId: () => state.chatId,
  getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }),
}));
vi.mock('@sillytavern/scripts/extensions', () => ({ getContext: () => state.context }));
const fetchMock = vi.fn<typeof fetch>();
const scope: ChatScope = { kind: 'character', avatar: 'Story.png', chatId: 'current' };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  state.chatId = 'current';
  state.context.groupId = null;
  state.context.characterId = 0;
});
afterEach(() => vi.unstubAllGlobals());

function respond(value: unknown): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
}

function lastRequestBody(): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string);
}

describe('聊天身份和只读来源接口', () => {
  it('单聊使用头像与聊天 ID，群聊优先使用群 ID', () => {
    expect(getCurrentChatScope()).toEqual(scope);
    state.context.groupId = 'group-1';
    state.context.characterId = -1;
    expect(getCurrentChatScope()).toEqual({ kind: 'group', groupId: 'group-1', chatId: 'current' });
    state.chatId = '';
    expect(getCurrentChatScope()).toBeNull();
  });

  it('同名聊天在不同卡或不同群中不是同一目标', () => {
    expect(isSameChatScope(scope, { ...scope })).toBe(true);
    expect(isSameChatScope(scope, { ...scope, avatar: 'Other.png' })).toBe(false);
    expect(isSameChatScope(scope, { ...scope, chatId: 'other' })).toBe(false);
    expect(isSameChatScope(null, null)).toBe(false);
    expect(isSameChatScope(
      { kind: 'group', groupId: 'a', chatId: 'same' },
      { kind: 'group', groupId: 'b', chatId: 'same' },
    )).toBe(false);
  });

  it('列表只请求同卡、排除当前聊天、按时间排序并保留 ID 原样', async () => {
    respond([
      { file_name: 'old', last_mes: '2026-01-01T12:00:00Z' },
      { file_name: 'current', last_mes: 99 },
      { file_name: 'new.jsonl', last_mes: '2026-10-01T12:00:00Z' },
      { file_name: 'bad-time', last_mes: 'invalid' },
      { file_name: null },
    ]);
    const options = await listPastChats(scope);
    expect(options.map(item => item.chatId)).toEqual(['new.jsonl', 'old', 'bad-time']);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chats/search');
    expect(lastRequestBody()).toEqual({ query: '', avatar_url: 'Story.png' });
    expect(fetchMock.mock.calls[0][1]!.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' });
  });

  it('群聊列表只传群 ID，支持旧版时间格式', async () => {
    respond([{ file_name: 'other', last_mes: '2026-10-2 @12h 3m 4s 5ms' }]);
    const options = await listPastChats({ kind: 'group', groupId: 'g1', chatId: 'current' });
    expect(options[0].updatedAt).toBe(new Date(2026, 9, 2, 12, 3, 4, 5).getTime());
    expect(lastRequestBody()).toEqual({ query: '', group_id: 'g1' });
  });

  it('按需导出一份聊天，只解析头 metadata，不解析或加载消息', async () => {
    const metadata = { cosmos_vision_profiles: [{ name: 'A' }], other_plugin: { kept: true } };
    respond({ result: '﻿' + JSON.stringify({ chat_metadata: metadata }) + '\r\nnot-json-message' });
    expect(await readPastChatMetadata(scope, 'source')).toEqual(metadata);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chats/export');
    expect(lastRequestBody()).toEqual({
      is_group: false, avatar_url: 'Story.png', file: 'source.jsonl', format: 'jsonl', exportfilename: 'source.jsonl',
    });
    expect(state.chatId).toBe('current');
  });

  it('群聊导出只使用所选聊天 ID，并且只补一次文件扩展名', async () => {
    respond({ result: JSON.stringify({ chat_metadata: {} }) });
    await readPastChatMetadata({ kind: 'group', groupId: 'g1', chatId: 'current' }, 'named.jsonl');
    expect(lastRequestBody()).toEqual({ is_group: true, file: 'named.jsonl.jsonl', format: 'jsonl', exportfilename: 'named.jsonl.jsonl' });
  });

  it('没有头或空文件没有档案，损坏的头报错', async () => {
    respond({ result: JSON.stringify({ mes: 'message without header' }) });
    expect(await readPastChatMetadata(scope, 'source')).toBeNull();
    respond({ result: '' });
    expect(await readPastChatMetadata(scope, 'source')).toBeNull();
    respond({ result: 'broken json\n{}' });
    await expect(readPastChatMetadata(scope, 'source')).rejects.toThrow('文件头损坏');
  });

  it('错误响应和异常列表不作为档案返回', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }));
    await expect(readPastChatMetadata(scope, 'source')).rejects.toThrow('已不存在');
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    await expect(listPastChats(scope)).rejects.toThrow('HTTP 500');
    respond({ error: true });
    await expect(listPastChats(scope)).rejects.toThrow('列表格式异常');
  });

  it('拒绝读取当前聊天并转发取消信号', async () => {
    await expect(readPastChatMetadata(scope, 'current')).rejects.toThrow('另一份');
    expect(fetchMock).not.toHaveBeenCalled();
    const controller = new AbortController();
    respond([]);
    await listPastChats(scope, controller.signal);
    controller.abort();
    expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});
