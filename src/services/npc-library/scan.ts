import type { PromptLlmSettings } from '@/constants/novelai';
import { extractNpcCandidates, type NpcExtractionCandidate } from '@/services/npc-library/extract';
import { readRecentChatContext } from '@/services/npc-library/scan-context';
import { getCurrentCharacterKey, getCurrentUserPersonaKey } from '@/services/tavern-helper/prompt-profiles-context';

/**
 * 收集需从 NPC 抽取中排除的名字(当前主角 + 用户 persona)
 * @returns 去空后的名字列表
 */
export function collectProtagonistNames(): string[] {
  return [getCurrentCharacterKey(), getCurrentUserPersonaKey()].filter((name): name is string => Boolean(name));
}

/**
 * 扫描当前聊天最近若干楼,抽取 NPC 外观候选(手动扫描入口)
 * @param settings Prompt LLM 配置
 * @param scanFloorCount 向前追溯的楼层数
 * @returns NPC 候选列表
 */
export async function scanNpcCandidatesFromCurrentChat(
  settings: PromptLlmSettings,
  scanFloorCount: number,
): Promise<NpcExtractionCandidate[]> {
  const context = await readRecentChatContext(scanFloorCount, settings.ignoreUserMessagesInHistory);
  if (!context) throw new Error('当前聊天没有可扫描的文本');
  return extractNpcCandidates(context, settings, { excludeNames: collectProtagonistNames() });
}
