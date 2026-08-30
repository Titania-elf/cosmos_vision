/**
 * 画师串池
 * 全局共享，NovelAI 与 ComfyUI 通用；每次生图从已启用条目中随机抽取一条
 */

/** 画师串池条目 */
export interface ArtistTagEntry {
  id: string;
  name: string;
  text: string;
  enabled: boolean;
}

/** 画师串池设置 */
export interface ArtistTagPoolSettings {
  enabled: boolean;
  entries: ArtistTagEntry[];
}

/**
 * 创建画师串池条目
 * @param id 条目 id
 * @param name 条目名称
 * @param text 画师串文本
 * @returns 画师串池条目
 */
export function createArtistTagEntry(id: string, name = '', text = ''): ArtistTagEntry {
  return { id, name, text, enabled: true };
}

/**
 * 创建画师串池设置
 * 默认关闭且为空池，保证升级后提示词构造不变
 * @returns 画师串池设置
 */
export function createArtistTagPoolSettings(): ArtistTagPoolSettings {
  return { enabled: false, entries: [] };
}
