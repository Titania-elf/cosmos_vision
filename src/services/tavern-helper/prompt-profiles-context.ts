import { getTavernHelper } from '@/services/tavern-helper/availability';
import { characters, chat_metadata, name2, this_chid } from '@sillytavern/script';
import { power_user } from '@sillytavern/scripts/power-user';

/**
 * 获取当前角色绑定 key
 * @returns 当前角色名或 null
 */
export function getCurrentCharacterKey(): string | null {
  return normalizeBindingKey(name2);
}

/**
 * 获取当前用户人设 绑定 key
 *
 * 解析顺序与 SillyTavern loadPersonaForCurrentChat 的收敛顺序保持一致，
 * 避免在 CHAT_CHANGED 早期（ST 尚在 await 拉取头像列表）读到滞后一拍的
 * user_avatar——那是慢半拍、读到上一个聊天人设的根因：
 *   1. 聊天锁定人设 chat_metadata.persona（同步、按聊天、无竞态）
 *   2. 与当前角色卡连接的人设（唯一匹配时）
 *   3. 全局默认人设 power_user.default_persona
 *   4. 当前实时人设（兜底，可能仍滞后）
 *
 * @returns 当前 persona key 或 null
 */
export function getCurrentUserPersonaKey(): string | null {
  const locked = readChatLockedPersona();
  if (locked) return locked;

  const connected = readConnectedPersonaToCurrentCharacter();
  if (connected) {
    const names = resolvePersonaDisplayNames(connected);
    if (names.length === 1) return names[0];
  }

  const defaultPersona = readDefaultPersona();
  if (defaultPersona) return defaultPersona;

  // 兜底：实时人设（仍可能因 ST 异步加载而滞后，仅作最后选择）
  const tavernHelper = getTavernHelper({ silent: true });
  if (!tavernHelper) return null;
  return (
    readPersonaGetter(() => tavernHelper.getCurrentPersonaName()) ??
    readPersonaGetter(() => tavernHelper.getCurrentPersonaId())
  );
}

/**
 * 读取聊天锁定人设（chat_metadata.persona）
 * @returns 锁定的人设 id 或 null
 */
function readChatLockedPersona(): string | null {
  try {
    return normalizeBindingKey((chat_metadata as Record<string, unknown>).persona);
  } catch (error) {
    console.debug('[CosmosVision] 读取聊天锁定人设失败:', error);
    return null;
  }
}

/**
 * 读取与当前角色卡连接的人设 id（连接关系存于 power_user.persona_descriptions）
 * @returns 唯一连接的人设 id，多连接/无连接返回 null
 */
function readConnectedPersonaToCurrentCharacter(): string | null {
  try {
    const characterKey = getCurrentCharacterAvatarKey();
    if (!characterKey) return null;
    const descriptions = (power_user.persona_descriptions ?? {}) as Record<
      string,
      { connections?: Array<{ id?: string }> }
    >;
    const matched = Object.keys(descriptions).filter(key => {
      const connections = descriptions[key]?.connections ?? [];
      return connections.some(conn => conn.id === characterKey);
    });
    return matched.length === 1 ? matched[0] : null;
  } catch (error) {
    console.debug('[CosmosVision] 读取角色连接人设失败:', error);
    return null;
  }
}

/**
 * 读取当前角色卡绑定 key（用于匹配 persona_descriptions 的 connection）
 * @returns 角色卡 avatar key 或 null
 */
function getCurrentCharacterAvatarKey(): string | null {
  try {
    const index = Number(this_chid);
    const character = Number.isFinite(index) ? characters?.[index] : undefined;
    return normalizeBindingKey((character as { avatar?: unknown } | undefined)?.avatar);
  } catch (error) {
    console.debug('[CosmosVision] 读取角色卡绑定 key 失败:', error);
    return null;
  }
}

/**
 * 读取全局默认人设 id
 * @returns 默认人设 id 或 null
 */
function readDefaultPersona(): string | null {
  return normalizeBindingKey(power_user.default_persona);
}

/**
 * 把 persona id 解析为显示名（power_user.personas 存 id → 显示名）
 * @param personaId persona id
 * @returns 命中列表（1 条 = 唯一命中；id 未登记时回退为 id 本身）
 */
function resolvePersonaDisplayNames(personaId: string): string[] {
  const normalized = normalizeBindingKey(personaId);
  if (!normalized) return [];
  try {
    const personas = (power_user.personas ?? {}) as Record<string, string>;
    const name = personas[normalized];
    return [normalizeBindingKey(name) ?? normalized];
  } catch (error) {
    console.debug('[CosmosVision] 解析 persona 显示名失败:', error);
    return [normalized];
  }
}

/**
 * 规范化绑定 key
 * @param value 原始绑定值
 * @returns 去空白后的绑定值或 null
 */
function normalizeBindingKey(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 安全读取 persona 字符串字段
 * @param getter persona 全局读取函数
 * @returns 标准化后的字段值或 null
 */
function readPersonaGetter(getter: () => string | null): string | null {
  try {
    return normalizeBindingKey(getter());
  } catch (error) {
    console.error('[CosmosVision] 读取当前 persona 失败', error);
    return null;
  }
}
