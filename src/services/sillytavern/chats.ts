import { getCurrentChatId, getRequestHeaders } from '@sillytavern/script';
import { getContext } from '@sillytavern/scripts/extensions';

/** 仅用于本次操作的会话身份；角色重命名或聊天切换后需要重新获取。 */
export type ChatScope =
  | { kind: 'character'; avatar: string; chatId: string }
  | { kind: 'group'; groupId: string; chatId: string };

export interface PastChatOption {
  chatId: string;
  updatedAt: number;
}

/** 群聊优先使用群组身份，不使用生成期间变化的发言角色 ID。 */
export function getCurrentChatScope(): ChatScope | null {
  const context = getContext();
  const chatId = getCurrentChatId();
  if (typeof chatId !== 'string' || !chatId) return null;
  if (context.groupId !== null && context.groupId !== undefined && context.groupId !== '') {
    return { kind: 'group', groupId: String(context.groupId), chatId };
  }
  const avatar = context.characterId === undefined ? undefined : context.characters[Number(context.characterId)]?.avatar;
  return typeof avatar === 'string' && avatar ? { kind: 'character', avatar, chatId } : null;
}

export function isSameChatScope(left: ChatScope | null, right: ChatScope | null): boolean {
  if (!left || !right || left.kind !== right.kind || left.chatId !== right.chatId) return false;
  return left.kind === 'character'
    ? right.kind === 'character' && left.avatar === right.avatar
    : right.kind === 'group' && left.groupId === right.groupId;
}

/** 使用宿主聊天管理接口，只返回同卡／同群的列表，不加载聊天到当前会话。 */
export async function listPastChats(scope: ChatScope, signal?: AbortSignal): Promise<PastChatOption[]> {
  const data = await requestChatJson(
    '/api/chats/search',
    scope.kind === 'group' ? { query: '', group_id: scope.groupId } : { query: '', avatar_url: scope.avatar },
    signal,
  );
  if (!Array.isArray(data)) throw new Error('聊天列表格式异常，请重试');
  const options = new Map<string, PastChatOption>();
  for (const item of data) {
    if (!isRecord(item) || typeof item.file_name !== 'string' || !item.file_name) continue;
    // /search 的 file_name 已经是不带文件扩展名的聊天 ID，不能再去掉后缀。
    if (item.file_name === scope.chatId) continue;
    options.set(item.file_name, { chatId: item.file_name, updatedAt: parseChatTimestamp(item.last_mes) });
  }
  return [...options.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.chatId.localeCompare(a.chatId));
}

/**
 * 直接读取选中聊天的 JSONL，保留聊天头，不触发宿主的加载／保存流程。
 * 使用 export 的原始 JSONL 分支，缺文件时也不会创建角色聊天目录。
 */
export async function readPastChatMetadata(scope: ChatScope, chatId: string, signal?: AbortSignal): Promise<unknown> {
  if (!chatId || chatId === scope.chatId) throw new Error('请选择另一份聊天记录');
  const data = await requestChatJson(
    '/api/chats/export',
    {
      is_group: scope.kind === 'group',
      ...(scope.kind === 'character' ? { avatar_url: scope.avatar } : {}),
      file: `${chatId}.jsonl`,
      format: 'jsonl',
      exportfilename: `${chatId}.jsonl`,
    },
    signal,
  );
  if (!isRecord(data) || typeof data.result !== 'string') throw new Error('聊天文件格式异常，请重试');
  const raw = data.result.charCodeAt(0) === 0xfeff ? data.result.slice(1) : data.result;
  const firstLine = raw.split(/\r?\n/, 1)[0];
  if (!firstLine.trim()) return null;
  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    throw new Error('聊天文件头损坏，无法读取档案');
  }
  if (!isRecord(header)) throw new Error('聊天文件头格式异常，无法读取档案');
  // 旧聊天可能没有 metadata 头；不能从消息正文或其他扩展字段猜测档案。
  return header.chat_metadata ?? null;
}

async function requestChatJson(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(url, {
    method: 'POST',
    headers: getRequestHeaders(),
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('来源聊天已不存在，请重新选择');
    throw new Error(`读取聊天失败（HTTP ${response.status}），请重试`);
  }
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseChatTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const numeric = Number(value);
  if (value.trim() && Number.isFinite(numeric)) return numeric;
  // 兼容旧版酒馆 YYYY-M-D @HHh MMm SSs MSms 时间格式。
  const legacy = /^(\d{4})-(\d{1,2})-(\d{1,2})\s*@\s*(\d{1,2})h\s*(\d{1,2})m\s*(\d{1,2})s(?:\s*(\d+)ms)?$/.exec(value);
  if (legacy) {
    const [, year, month, day, hour, minute, second, ms] = legacy;
    return new Date(+year, +month - 1, +day, +hour, +minute, +second, Number(ms ?? 0)).getTime();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
