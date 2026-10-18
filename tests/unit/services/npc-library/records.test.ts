import { describe, expect, it } from 'vitest';
import { parseNpcRecords, stripNpcRecords } from '@/services/npc-library/records';

const record =
  '<!-- cv-npcs {"npcs":[{"name":"Aiko","role":"supporting","aliases":[],"appearanceTags":"blue hair, red dress","appearanceNote":""}]} -->';

describe('NPC 隐藏建档记录', () => {
  it('只解析闭合的有效记录，错误 JSON 和未完成的流式记录不入库', () => {
    expect(parseNpcRecords(`正文\n<!-- cv-npcs invalid -->\n${record}`)).toEqual([
      { name: 'Aiko', aliases: [], appearanceTags: 'blue hair', appearanceNote: '' },
    ]);
    expect(parseNpcRecords(record.replace(' -->', ''))).toEqual([]);
    expect(parseNpcRecords('普通聊天')).toEqual([]);
  });

  it('完整和未闭合的 NPC 记录从正文移除，服装记录独立保留', () => {
    const outfit = '<!-- cv-outfits {"updates":[]} -->';
    expect(stripNpcRecords(`正文${record}${outfit}`)).toBe(`正文${outfit}`);
    expect(stripNpcRecords('正文<!-- cv-npcs {"npcs":[')).toBe('正文');
  });

  it('排除主角姓名及别名，不接受没有稳定姓名的坏数据', () => {
    expect(parseNpcRecords(record, ['aiko'])).toEqual([]);
    expect(
      parseNpcRecords('<!-- cv-npcs {"npcs":[{"name":"勇者","role":"supporting","aliases":["Hero"]}]} -->', ['hero']),
    ).toEqual([]);
    expect(parseNpcRecords('<!-- cv-npcs {"npcs":[null,{}, {"name":""}]} -->')).toEqual([]);
  });

  it('外观标签和补充说明均过滤服装配饰，保留身体特征', () => {
    const text = `<!-- cv-npcs ${JSON.stringify({
      npcs: [
        {
          name: 'Aiko',
          role: 'supporting',
          appearanceTags:
            'Blue_Hair, red-eyes, school uniform, white shirt, black thighhighs, hair ribbon, glasses, elf ears',
          appearanceNote: 'Pointed ears. She wears a silver necklace. A mole below her left eye.',
        },
      ],
    })} -->`;
    expect(parseNpcRecords(text)).toEqual([
      {
        name: 'Aiko',
        aliases: [],
        appearanceTags: 'blue hair, red eyes, elf ears',
        appearanceNote: 'Pointed ears. A mole below her left eye.',
      },
    ]);
  });

  it('配角只有穿戴描写时保留姓名档案，等待后续身体外观', () => {
    const text =
      '<!-- cv-npcs {"npcs":[{"name":"Aiko","role":"supporting","appearanceTags":"red dress, glasses","appearanceNote":"她穿着校服。"}]} -->';
    expect(parseNpcRecords(text)).toEqual([{ name: 'Aiko', aliases: [], appearanceTags: '', appearanceNote: '' }]);
  });

  it('不为具名路人、不确定人物或没有配角判断的旧记录建立姓名档案', () => {
    for (const role of ['incidental', 'uncertain', 'protagonist', undefined]) {
      const text = `<!-- cv-npcs ${JSON.stringify({ npcs: [{ name: '小王', role, appearanceTags: '', appearanceNote: '' }] })} -->`;
      expect(parseNpcRecords(text)).toEqual([]);
    }
  });
});
