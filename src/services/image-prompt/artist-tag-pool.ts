import type { ArtistTagPoolSettings } from '@/constants/artist-tag';

/**
 * 从画师串池抽取本次生图使用的画师串
 * 必须在每次请求构建时只调用一次，避免同一次请求内抽出不一致结果
 * @param pool 画师串池设置
 * @returns 抽中的画师串，池未启用或无可用条目时为空串
 */
export function pickRandomArtistTag(pool?: ArtistTagPoolSettings): string {
  if (!pool?.enabled) return '';
  const candidates = pool.entries.filter(entry => entry.enabled && entry.text.trim()).map(entry => entry.text.trim());
  if (!candidates.length) return '';
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

/**
 * 将画师串前置到正向提示词最前面
 * @param positivePrompt 已拼接完成的正向提示词
 * @param artistTag 本次抽中的画师串
 * @returns 前置画师串后的正向提示词
 */
export function prependArtistTag(positivePrompt: string, artistTag: string): string {
  return [artistTag.trim(), positivePrompt.trim()].filter(Boolean).join(', ');
}
