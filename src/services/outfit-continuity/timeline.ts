import type { OutfitRecord, OutfitUpdate } from '@/constants/outfit-continuity';
import { stripSlotShortcodes } from '@/services/inline-image/slot-shortcode';

const OUTFIT_COMMENT_SOURCE = '<!--\\s*cv-outfits\\b([\\s\\S]*?)(?:-->|$)';

export interface OutfitMessage {
  mes?: string;
  is_user?: boolean;
  is_system?: boolean;
}

/** 不将隐藏记录混入正文上下文，也剥离流式输出中未闭合的记录。 */
export function stripOutfitRecords(text: string): string {
  return text.replace(new RegExp(OUTFIT_COMMENT_SOURCE, 'gi'), '');
}

export function parseOutfitUpdates(text: string): OutfitUpdate[] {
  const result: OutfitUpdate[] = [];
  for (const match of text.matchAll(new RegExp(OUTFIT_COMMENT_SOURCE, 'gi'))) {
    try {
      const data = JSON.parse(match[1]!.trim()) as { updates?: unknown };
      if (!data || !Array.isArray(data.updates)) continue;
      for (const value of data.updates) {
        if (!value || typeof value !== 'object') continue;
        const update = value as Record<string, unknown>;
        if (typeof update.name !== 'string' || !update.name.trim() || typeof update.outfit !== 'string') continue;
        if (!Number.isInteger(update.fromParagraph) || Number(update.fromParagraph) < 1) continue;
        result.push({
          name: update.name.trim(),
          outfit: update.outfit.trim(),
          fromParagraph: Number(update.fromParagraph),
          ...(typeof update.fromText === 'string' && update.fromText.trim()
            ? { fromText: update.fromText.trim() }
            : {}),
        });
      }
    } catch {
      // 一条损坏记录不影响其他消息，也不修改正文。
    }
  }
  return result;
}

export interface OutfitPosition {
  messageIndex: number;
  paragraphIndex?: number;
  /** 本消息开头到焦点末段的可见正文；用于定位 fromText。 */
  focusMessageText?: string;
}

/** 每次从当前激活消息重放，切分支、编辑、删除后自动使用当前时间线。 */
export function resolveOutfitRecords(messages: readonly OutfitMessage[], position: OutfitPosition): OutfitRecord[] {
  const current = new Map<string, OutfitRecord>();
  for (let index = 0; index <= position.messageIndex && index < messages.length; index++) {
    const message = messages[index];
    if (!message || message.is_user || message.is_system) continue;
    const updates = parseOutfitUpdates(message.mes ?? '');
    // 稳定排序使较晚的换装生效，同段落的手动纠正覆盖模型记录。
    updates.sort((a, b) => a.fromParagraph - b.fromParagraph);
    for (const update of updates) {
      if (index === position.messageIndex && !isUpdateEffective(update, position)) continue;
      current.set(update.name.toLocaleLowerCase(), { ...update, messageIndex: index });
    }
  }
  return [...current.values()];
}

function isUpdateEffective(update: OutfitUpdate, position: OutfitPosition): boolean {
  if (position.paragraphIndex === undefined && position.focusMessageText === undefined) return true;
  if (update.fromText && position.focusMessageText !== undefined) {
    return normalizeAnchorText(position.focusMessageText).includes(normalizeAnchorText(update.fromText));
  }
  return update.fromParagraph <= (position.paragraphIndex ?? 1);
}

function normalizeAnchorText(text: string): string {
  return stripSlotShortcodes(stripOutfitRecords(text)).replace(/[\s*_`~]/g, '');
}

export function appendOutfitUpdate(text: string, update: OutfitUpdate): string {
  // 防止自然语言里的 --> 提前终止 HTML 注释；JSON.parse 会还原转义字符。
  const payload = JSON.stringify({ updates: [update] })
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
  return `${text.trimEnd()}\n\n<!-- cv-outfits ${payload} -->`;
}

export function formatOutfitContext(records: OutfitRecord[], purpose: 'story' | 'image'): string {
  if (!records.length) return '';
  const instruction =
    purpose === 'story'
      ? '以下为当前聊天已生效的穿着快照。继续正文时延续穿着，只按剧情变化更新。'
      : '以下为目标消息和段落当时生效的穿着快照。仅用于画面中实际出场的人物；正文明确描写的当前变化和本次特别要求优先。穿着快照优先于人物档案、NPC 库或固定 tag 中的默认服装；不要把其他人物或之后的换装画进当前场景。';
  const data = records.map(({ name, outfit }) => ({ name, outfit: outfit || '未穿戴衣物或配饰' }));
  return `${instruction}\n${JSON.stringify(data).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')}`;
}
