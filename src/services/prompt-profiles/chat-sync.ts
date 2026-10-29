import { uuidv4 } from '@sillytavern/scripts/utils';

import {
  getPromptPersonTemplateEntryKind,
  normalizePromptPersonTemplateEntryId,
  type PromptPerson,
} from '@/constants/prompt-llm';

export type ChatProfileSyncMode = 'missing' | 'overwrite';
export type ChatProfileSyncAction = 'add' | 'overwrite' | 'skip' | 'conflict';

export interface ChatProfileSyncItem {
  source: PromptPerson;
  action: ChatProfileSyncAction;
}

/** 用户和角色分别匹配；名称忽略首尾空格和大小写。 */
export function getChatProfileSyncKey(person: PromptPerson): string {
  return `${person.kind}:${person.name.trim().toLowerCase()}`;
}

/** 按来源顺序预览；重复来源一律冲突，不生成 ID，也不修改任何档案。 */
export function previewChatProfileSync(
  existing: PromptPerson[],
  selected: PromptPerson[],
  mode: ChatProfileSyncMode,
): ChatProfileSyncItem[] {
  const existingCounts = countProfileKeys(existing);
  const selectedCounts = countProfileKeys(selected);
  return selected.map(source => {
    const key = getChatProfileSyncKey(source);
    const targetCount = existingCounts.get(key) ?? 0;
    let action: ChatProfileSyncAction;
    if ((selectedCounts.get(key) ?? 0) > 1) action = 'conflict';
    else if (!targetCount) action = 'add';
    else if (mode === 'missing') action = 'skip';
    else action = targetCount === 1 ? 'overwrite' : 'conflict';
    return { source, action };
  });
}

/**
 * 应用预览结果但不写 metadata。
 * 未触碰档案保持原顺序和对象；覆盖完整替换内容、保留目标人物 ID；新增追加到末尾。
 */
export function applyChatProfileSync(
  existing: PromptPerson[],
  selected: PromptPerson[],
  mode: ChatProfileSyncMode,
): { profiles: PromptPerson[]; items: ChatProfileSyncItem[] } {
  const items = previewChatProfileSync(existing, selected, mode);
  const profiles = [...existing];
  const targetIndices = new Map(existing.map((person, index) => [getChatProfileSyncKey(person), index]));
  for (const item of items) {
    if (item.action === 'add') {
      profiles.push(copyProfile(item.source, uuidv4()));
    } else if (item.action === 'overwrite') {
      const index = targetIndices.get(getChatProfileSyncKey(item.source))!;
      profiles[index] = copyProfile(item.source, existing[index].id);
    }
  }
  return { profiles, items };
}

function countProfileKeys(profiles: PromptPerson[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const person of profiles) {
    const key = getChatProfileSyncKey(person);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function copyProfile(source: PromptPerson, id: string): PromptPerson {
  return {
    ...source,
    id,
    triggerKeywords: [...source.triggerKeywords],
    templateEntries: source.templateEntries.map(entry => ({
      ...entry,
      id: normalizePromptPersonTemplateEntryId(uuidv4(), getPromptPersonTemplateEntryKind(entry)),
      reference: entry.reference ? { ...entry.reference } : undefined,
    })),
  };
}
