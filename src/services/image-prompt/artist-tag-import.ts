import type { ArtistTagEntry } from '@/constants/artist-tag';

export const ARTIST_TAG_IMPORT_FORMAT = 'cosmos-vision-artist-tag-pool';
export const ARTIST_TAG_IMPORT_VERSION = 1;

const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_IMPORT_ENTRIES = 2000;
const MAX_ARTIST_TAG_LENGTH = 4096;
const MAX_ARTIST_TAG_NAME_LENGTH = 200;

/** 画师串 JSON 导入文件 */
export interface ArtistTagImportFile {
  format: typeof ARTIST_TAG_IMPORT_FORMAT;
  version: typeof ARTIST_TAG_IMPORT_VERSION;
  name?: string;
  entries: unknown[];
}

/** 解析后的画师串条目，导入时再生成本地 id */
export interface ParsedArtistTagEntry {
  name: string;
  text: string;
  enabled: boolean;
}

/** 画师串导入预览 */
export interface ArtistTagImportPreview {
  packageName: string;
  entries: ParsedArtistTagEntry[];
  invalidCount: number;
  duplicateCount: number;
  warnings: string[];
}

/**
 * 解析画师串 JSON 导入文件
 * @param text JSON 文本
 * @param existingEntries 当前画师串池条目
 * @returns 可追加的导入预览
 */
export function parseArtistTagImportText(
  text: string,
  existingEntries: readonly ArtistTagEntry[] = [],
): ArtistTagImportPreview {
  const source = stripUtf8Bom(text);
  assertImportSize(source);

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error('画师串 JSON 解析失败，请检查文件内容');
  }

  const file = toRecord(value);
  if (file.format !== ARTIST_TAG_IMPORT_FORMAT) {
    throw new Error('不是有效的画师串 JSON 文件');
  }
  if (file.version !== ARTIST_TAG_IMPORT_VERSION) {
    throw new Error(`不支持的画师串 JSON 版本：${String(file.version)}`);
  }
  if (!Array.isArray(file.entries)) {
    throw new Error('画师串 JSON 的 entries 必须是数组');
  }
  if (file.entries.length > MAX_IMPORT_ENTRIES) {
    throw new Error(`画师串数量超过上限 ${MAX_IMPORT_ENTRIES} 条`);
  }

  const packageName = readPackageName(file.name);
  const seen = new Set(existingEntries.map(entry => normalizeArtistTagText(entry.text)));
  const entries: ParsedArtistTagEntry[] = [];
  const warnings: string[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  file.entries.forEach((value, index) => {
    const entry = toRecord(value);
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) {
      invalidCount += 1;
      warnings.push(`第 ${index + 1} 条画师串为空或缺少 text，已跳过`);
      return;
    }
    if (text.length > MAX_ARTIST_TAG_LENGTH) {
      invalidCount += 1;
      warnings.push(`第 ${index + 1} 条画师串超过 ${MAX_ARTIST_TAG_LENGTH} 字符，已跳过`);
      return;
    }

    const enabled = entry.enabled === undefined ? true : entry.enabled;
    if (typeof enabled !== 'boolean') {
      invalidCount += 1;
      warnings.push(`第 ${index + 1} 条画师串的 enabled 不是布尔值，已跳过`);
      return;
    }

    const name = readEntryName(entry.name, text);
    if (name.length > MAX_ARTIST_TAG_NAME_LENGTH) {
      invalidCount += 1;
      warnings.push(`第 ${index + 1} 条画师串名称超过 ${MAX_ARTIST_TAG_NAME_LENGTH} 字符，已跳过`);
      return;
    }

    const key = normalizeArtistTagText(text);
    if (seen.has(key)) {
      duplicateCount += 1;
      warnings.push(`第 ${index + 1} 条画师串重复，已跳过：${text}`);
      return;
    }

    seen.add(key);
    entries.push({ name, text, enabled });
  });

  if (!entries.length) {
    throw new Error('文件中没有可新增的画师串');
  }

  return { packageName, entries, invalidCount, duplicateCount, warnings };
}

/**
 * 移除 UTF-8 BOM
 * @param text 原始文本
 * @returns 移除 BOM 后的文本
 */
function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 校验导入文件大小
 * @param text JSON 文本
 */
function assertImportSize(text: string): void {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_IMPORT_BYTES) {
    throw new Error(`画师串 JSON 超过 ${MAX_IMPORT_BYTES / 1024} KB 上限`);
  }
}

/**
 * 读取画师串包名称
 * @param value 原始名称
 * @returns 有效名称
 */
function readPackageName(value: unknown): string {
  if (typeof value !== 'string') return '画师串包';
  const name = value.trim();
  return name.slice(0, MAX_ARTIST_TAG_NAME_LENGTH) || '画师串包';
}

/**
 * 读取画师串条目名称
 * @param value 原始名称
 * @param text 画师串内容
 * @returns 有效名称
 */
function readEntryName(value: unknown, text: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (text.startsWith('@')) return text.slice(1).trim() || text;
  if (text.toLowerCase().startsWith('artist:')) return text.slice('artist:'.length).trim() || text;
  return text.slice(0, 20);
}

/**
 * 规范化画师串用于重复判断
 * @param text 画师串内容
 * @returns 规范化文本
 */
function normalizeArtistTagText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').toLowerCase();
}

/**
 * 转换为记录对象
 * @param value 原始值
 * @returns 记录对象
 */
function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
