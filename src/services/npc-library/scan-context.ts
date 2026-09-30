import { getOptionalTavernHelper } from '@/services/tavern-helper/availability';
import { buildRegexedHistory } from '@/services/tavern-helper/history-builder';

/**
 * 读取当前聊天最近若干楼的纯文本(经 ST 正则处理),供 NPC 扫描使用
 * @param scanFloorCount 向前追溯的楼层数
 * @param ignoreUserMessages 是否忽略用户楼层
 * @returns 拼接后的文本;读取失败或无消息时为空串
 */
export async function readRecentChatContext(scanFloorCount: number, ignoreUserMessages: boolean): Promise<string> {
  const lastId = readLastMessageId();
  if (lastId === null) return '';
  const result = await buildRegexedHistory({
    currentMessageIndex: lastId,
    historyFloorCount: scanFloorCount,
    ignoreUserMessages,
    reverseOrder: false,
  });
  return result.success ? result.text.trim() : '';
}

/**
 * 读取以指定楼层结尾的最近若干楼文本(供后台单条消息触发的自动更新使用)
 * @param messageId 触发消息的楼层号
 * @param scanFloorCount 向前追溯的楼层数(含该楼)
 * @param ignoreUserMessages 是否忽略用户楼层
 * @returns 拼接后的文本;读取失败时为空串
 */
export async function readChatContextEndingAt(
  messageId: number,
  scanFloorCount: number,
  ignoreUserMessages: boolean,
): Promise<string> {
  if (!Number.isInteger(messageId) || messageId < 0) return '';
  const result = await buildRegexedHistory({
    currentMessageIndex: messageId,
    historyFloorCount: scanFloorCount,
    ignoreUserMessages,
    reverseOrder: false,
  });
  return result.success ? result.text.trim() : '';
}

/**
 * 读取当前聊天最后一条消息的楼层号
 * @returns 楼层号;读取失败或空聊天时为 null
 */
function readLastMessageId(): number | null {
  const tavernHelper = getOptionalTavernHelper();
  if (typeof tavernHelper?.getChatMessages !== 'function') return null;
  try {
    const messages = tavernHelper.getChatMessages(-1, { role: 'all', hide_state: 'all' });
    if (!Array.isArray(messages) || !messages.length) return null;
    const id = messages[messages.length - 1].message_id;
    return typeof id === 'number' && id >= 0 ? id : null;
  } catch (error) {
    console.debug('[CosmosVision] 读取最后楼层号失败:', error);
    return null;
  }
}
