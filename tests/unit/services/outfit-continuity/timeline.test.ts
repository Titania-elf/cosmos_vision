import { describe, expect, it } from 'vitest';
import {
  appendOutfitUpdate,
  formatOutfitContext,
  parseOutfitUpdates,
  resolveOutfitRecords,
  stripOutfitRecords,
} from '@/services/outfit-continuity/timeline';

const outfitMessage = (outfit: string, fromParagraph = 1, fromText?: string) => ({
  mes: appendOutfitUpdate('第一段。\n\n第二段。\n\n她换上睡衣。', { name: '小明', outfit, fromParagraph, fromText }),
  is_user: false,
});

describe('服装时间线', () => {
  it('延续未更新人物，旧消息不读取之后的换装', () => {
    const messages = [outfitMessage('校服、白袜'), { mes: '继续上课', is_user: true }, outfitMessage('睡衣')];
    expect(resolveOutfitRecords(messages, { messageIndex: 1 })[0]?.outfit).toBe('校服、白袜');
    expect(resolveOutfitRecords(messages, { messageIndex: 2 })[0]?.outfit).toBe('睡衣');
  });

  it('按段落读取同一回复中的换装，不使用末尾快照覆盖前段', () => {
    const message = outfitMessage('校服');
    message.mes = appendOutfitUpdate(message.mes, { name: '小明', outfit: '睡衣', fromParagraph: 3 });
    expect(resolveOutfitRecords([message], { messageIndex: 0, paragraphIndex: 2 })[0]?.outfit).toBe('校服');
    expect(resolveOutfitRecords([message], { messageIndex: 0, paragraphIndex: 3 })[0]?.outfit).toBe('睡衣');
  });

  it('用正文原句定位前端气泡，不依赖 HTML 的块数', () => {
    const messages = [outfitMessage('校服'), outfitMessage('睡衣', 3, '她换上睡衣。')];
    expect(
      resolveOutfitRecords(messages, { messageIndex: 1, paragraphIndex: 8, focusMessageText: '第二段。' })[0]?.outfit,
    ).toBe('校服');
    expect(
      resolveOutfitRecords(messages, {
        messageIndex: 1,
        paragraphIndex: 1,
        focusMessageText: '第二段。\n\n她**换上睡衣**。',
      })[0]?.outfit,
    ).toBe('睡衣');
  });

  it('切分支、编辑、删除后根据当前正文重新计算', () => {
    const messages = [outfitMessage('校服'), outfitMessage('睡衣')];
    messages[1] = outfitMessage('泳衣');
    expect(resolveOutfitRecords(messages, { messageIndex: 1 })[0]?.outfit).toBe('泳衣');
    messages[1]!.mes = '没有记录的重写正文';
    expect(resolveOutfitRecords(messages, { messageIndex: 1 })[0]?.outfit).toBe('校服');
    messages.pop();
    expect(resolveOutfitRecords(messages, { messageIndex: 0 })[0]?.outfit).toBe('校服');
  });

  it('同段手动纠正覆盖原记录，后段换装继续生效', () => {
    let message = outfitMessage('校服').mes;
    message = appendOutfitUpdate(message, { name: '小明', outfit: '睡衣', fromParagraph: 3 });
    message = appendOutfitUpdate(message, { name: '小明', outfit: '校服、黑袜', fromParagraph: 1 });
    expect(resolveOutfitRecords([{ mes: message }], { messageIndex: 0, paragraphIndex: 1 })[0]?.outfit).toBe(
      '校服、黑袜',
    );
    expect(resolveOutfitRecords([{ mes: message }], { messageIndex: 0, paragraphIndex: 3 })[0]?.outfit).toBe('睡衣');
  });

  it('跳过损坏 JSON、无效段落和用户/系统输出，完整快照替换旧穿着', () => {
    const invalid =
      '<!-- cv-outfits null --><!-- cv-outfits {"updates":[{"name":"小明","outfit":"错误","fromParagraph":0}]} -->';
    const messages = [
      outfitMessage('校服、鞋袜'),
      { mes: invalid },
      { ...outfitMessage('伪造'), is_user: true },
      { ...outfitMessage('伪造'), is_system: true },
      outfitMessage(''),
    ];
    expect(parseOutfitUpdates(invalid)).toEqual([]);
    const records = resolveOutfitRecords(messages, { messageIndex: 4 });
    expect(records[0]?.outfit).toBe('');
    expect(formatOutfitContext(records, 'image')).toContain('未穿戴衣物或配饰');
    expect(formatOutfitContext(records, 'image')).not.toContain('校服、鞋袜');
  });

  it('隐藏完整和流式记录，保留其他注释、正文与生图短码', () => {
    const raw = appendOutfitUpdate('正文\n⟦cv:abcd1234⟧\n<!-- 其他注释 -->', {
      name: '小明',
      outfit: '校服',
      fromParagraph: 1,
    });
    expect(stripOutfitRecords(raw).trim()).toBe('正文\n⟦cv:abcd1234⟧\n<!-- 其他注释 -->');
    expect(stripOutfitRecords('正文\n<!-- cv-outfits {"updates":[').trim()).toBe('正文');
    expect(parseOutfitUpdates('<!-- cv-outfits {broken} -->' + raw)).toHaveLength(1);
  });

  it('手动输入包含注释终止符仍能安全保存并完整还原', () => {
    const outfit = '蓝衣 --> <配饰>，"丝带"';
    const raw = appendOutfitUpdate('正文', { name: '小明', outfit, fromParagraph: 1 });
    expect(raw.match(/-->/g)).toHaveLength(1);
    expect(parseOutfitUpdates(raw)[0]?.outfit).toBe(outfit);
  });
});
