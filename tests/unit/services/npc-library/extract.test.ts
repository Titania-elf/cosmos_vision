import { describe, expect, it } from 'vitest';

import { parseNpcExtractionResult } from '@/services/npc-library/extract';

/** 包裹成 <output> 输出 */
function wrap(json: unknown): string {
  return `some reasoning...\n<output>${JSON.stringify(json)}</output>`;
}

describe('parseNpcExtractionResult', () => {
  it('parses NPC candidates from an <output> wrapped JSON object', () => {
    const raw = wrap({ npcs: [{ name: 'Aiko', aliases: ['小爱'], appearanceTags: 'blue hair, red eyes', appearanceNote: '' }] });
    const result = parseNpcExtractionResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Aiko', aliases: ['小爱'], appearanceTags: 'blue hair, red eyes' });
  });

  it('drops candidates without appearance tags', () => {
    const raw = wrap({ npcs: [{ name: 'Ghost', aliases: [], appearanceTags: '   ', appearanceNote: '' }] });
    expect(parseNpcExtractionResult(raw)).toHaveLength(0);
  });

  it('excludes protagonist/persona names case-insensitively', () => {
    const raw = wrap({
      npcs: [
        { name: 'Hero', aliases: [], appearanceTags: 'blonde hair', appearanceNote: '' },
        { name: 'Aiko', aliases: [], appearanceTags: 'blue hair', appearanceNote: '' },
      ],
    });
    const result = parseNpcExtractionResult(raw, ['hero']);
    expect(result.map(item => item.name)).toEqual(['Aiko']);
  });

  it('returns an empty array when npcs is missing or empty', () => {
    expect(parseNpcExtractionResult(wrap({ npcs: [] }))).toEqual([]);
    expect(parseNpcExtractionResult(wrap({}))).toEqual([]);
  });

  it('throws on non-JSON payloads', () => {
    expect(() => parseNpcExtractionResult('not json at all')).toThrow();
  });
});
