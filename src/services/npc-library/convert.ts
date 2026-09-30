import type { PromptPerson } from '@/constants/prompt-llm';
import { createNpcLibraryEntry, type NpcLibraryEntry } from '@/constants/npc-library';

/**
 * 把当前聊天的人物档案转换为 NPC 库条目(聊天档案 → 库,用于把已有配角存入库复用)
 * 只搬运名字、触发词、固定 tag 与触发模式;外观补充留空由用户后续维护
 * @param person 人物档案
 * @param group 目标分组
 * @returns NPC 库条目
 */
export function promptPersonToNpcEntry(person: PromptPerson, group: string): NpcLibraryEntry {
  const aliases = person.triggerKeywords.filter(keyword => keyword.trim() && keyword.trim() !== person.name.trim());
  const entry = createNpcLibraryEntry(person.name, group, aliases);
  entry.enabled = person.enabled !== false;
  entry.insertMode = person.insertMode;
  entry.staticTags = person.staticTags;
  return entry;
}
