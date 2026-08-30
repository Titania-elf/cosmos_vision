import { afterEach, describe, expect, it, vi } from 'vitest';
import { createArtistTagEntry, createArtistTagPoolSettings } from '@/constants/artist-tag';
import {
  ARTIST_TAG_IMPORT_FORMAT,
  ARTIST_TAG_IMPORT_VERSION,
  parseArtistTagImportText,
} from '@/services/image-prompt/artist-tag-import';
import { pickRandomArtistTag, prependArtistTag } from '@/services/image-prompt/artist-tag-pool';

/**
 * 构建测试用画师串池
 * @param enabled 总开关
 * @param entries 条目定义
 * @returns 画师串池设置
 */
function createPool(enabled: boolean, entries: Array<{ text: string; entryEnabled?: boolean }>) {
  return {
    ...createArtistTagPoolSettings(),
    enabled,
    entries: entries.map((entry, index) => ({
      ...createArtistTagEntry(`entry-${index}`, `画师串 ${index}`, entry.text),
      enabled: entry.entryEnabled ?? true,
    })),
  };
}

describe('pickRandomArtistTag', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string when pool is undefined', () => {
    expect(pickRandomArtistTag(undefined)).toBe('');
  });

  it('returns empty string when master switch is off', () => {
    const pool = createPool(false, [{ text: 'artist:wlop' }]);
    expect(pickRandomArtistTag(pool)).toBe('');
  });

  it('returns empty string when pool has no entries', () => {
    expect(pickRandomArtistTag(createArtistTagPoolSettings())).toBe('');
    expect(pickRandomArtistTag({ enabled: true, entries: [] })).toBe('');
  });

  it('returns empty string when every entry is disabled', () => {
    const pool = createPool(true, [
      { text: 'artist:wlop', entryEnabled: false },
      { text: 'artist:ciloranko', entryEnabled: false },
    ]);
    expect(pickRandomArtistTag(pool)).toBe('');
  });

  it('returns empty string when every enabled entry is blank', () => {
    const pool = createPool(true, [{ text: '   ' }, { text: '' }]);
    expect(pickRandomArtistTag(pool)).toBe('');
  });

  it('always returns the only enabled entry', () => {
    const pool = createPool(true, [
      { text: 'artist:wlop', entryEnabled: false },
      { text: 'artist:ciloranko' },
      { text: '   ' },
    ]);
    for (let i = 0; i < 20; i += 1) {
      expect(pickRandomArtistTag(pool)).toBe('artist:ciloranko');
    }
  });

  it('picks by index over candidates filtered from disabled and blank entries', () => {
    const pool = createPool(true, [
      { text: 'artist:skipped', entryEnabled: false },
      { text: 'artist:first' },
      { text: '  ', entryEnabled: true },
      { text: 'artist:second' },
    ]);

    const random = vi.spyOn(Math, 'random');

    random.mockReturnValue(0);
    expect(pickRandomArtistTag(pool)).toBe('artist:first');

    random.mockReturnValue(0.99);
    expect(pickRandomArtistTag(pool)).toBe('artist:second');
  });

  it('trims the picked entry text', () => {
    const pool = createPool(true, [{ text: '  artist:wlop, artist:guweiz  ' }]);
    expect(pickRandomArtistTag(pool)).toBe('artist:wlop, artist:guweiz');
  });
});

describe('prependArtistTag', () => {
  it('prepends the artist tag in front of the positive prompt', () => {
    expect(prependArtistTag('masterpiece, 1girl', 'artist:wlop')).toBe('artist:wlop, masterpiece, 1girl');
  });

  it('leaves the prompt untouched when the artist tag is empty', () => {
    expect(prependArtistTag('masterpiece, 1girl', '')).toBe('masterpiece, 1girl');
    expect(prependArtistTag('masterpiece, 1girl', '   ')).toBe('masterpiece, 1girl');
  });

  it('returns only the artist tag when the prompt is empty', () => {
    expect(prependArtistTag('', 'artist:wlop')).toBe('artist:wlop');
    expect(prependArtistTag('  ', 'artist:wlop')).toBe('artist:wlop');
  });

  it('returns empty string when both sides are empty', () => {
    expect(prependArtistTag('', '')).toBe('');
  });
});

describe('parseArtistTagImportText', () => {
  it('parses valid JSON entries and generates names from artist IDs', () => {
    const preview = parseArtistTagImportText(
      JSON.stringify({
        format: ARTIST_TAG_IMPORT_FORMAT,
        version: ARTIST_TAG_IMPORT_VERSION,
        name: '测试画师包',
        entries: [
          { text: '  @wlop  ' },
          { name: '组合画师', text: '@wlop, @ciloranko', enabled: false },
        ],
      }),
    );

    expect(preview.packageName).toBe('测试画师包');
    expect(preview.entries).toEqual([
      { name: 'wlop', text: '@wlop', enabled: true },
      { name: '组合画师', text: '@wlop, @ciloranko', enabled: false },
    ]);
    expect(preview.invalidCount).toBe(0);
    expect(preview.duplicateCount).toBe(0);
    expect(preview.warnings).toEqual([]);
  });

  it('accepts a UTF-8 BOM', () => {
    const source = JSON.stringify({
      format: ARTIST_TAG_IMPORT_FORMAT,
      version: ARTIST_TAG_IMPORT_VERSION,
      entries: [{ text: '@wlop' }],
    });
    const preview = parseArtistTagImportText(`\uFEFF${source}`);

    expect(preview.entries).toHaveLength(1);
  });

  it('rejects unsupported formats and versions', () => {
    expect(() => parseArtistTagImportText('{}')).toThrow('不是有效的画师串 JSON 文件');
    expect(() =>
      parseArtistTagImportText(
        JSON.stringify({ format: ARTIST_TAG_IMPORT_FORMAT, version: 2, entries: [] }),
      ),
    ).toThrow('不支持的画师串 JSON 版本：2');
  });

  it('skips invalid entries and duplicates from the current pool', () => {
    const currentPool = createPool(true, [{ text: '@wlop' }]);
    const preview = parseArtistTagImportText(
      JSON.stringify({
        format: ARTIST_TAG_IMPORT_FORMAT,
        version: ARTIST_TAG_IMPORT_VERSION,
        entries: [
          { text: '@wlop' },
          { text: '@WLOP' },
          { text: '' },
          { text: '@ciloranko', enabled: 'yes' },
          { text: '@guweiz' },
        ],
      }),
      currentPool.entries,
    );

    expect(preview.entries.map(entry => entry.text)).toEqual(['@guweiz']);
    expect(preview.invalidCount).toBe(2);
    expect(preview.duplicateCount).toBe(2);
    expect(preview.warnings).toHaveLength(4);
  });

  it('throws when no importable entries remain', () => {
    expect(() =>
      parseArtistTagImportText(
        JSON.stringify({ format: ARTIST_TAG_IMPORT_FORMAT, version: ARTIST_TAG_IMPORT_VERSION, entries: [] }),
      ),
    ).toThrow('文件中没有可新增的画师串');
  });
});
