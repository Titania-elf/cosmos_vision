import { beforeEach, describe, expect, it } from 'vitest';

import { chat_metadata } from '@sillytavern/script';
import { power_user } from '@sillytavern/scripts/power-user';
import { getCurrentCharacterKey, getCurrentUserPersonaKey } from '@/services/tavern-helper/prompt-profiles-context';

/** power_user mock 形状（对齐 ST 实际字段，测试内做局部断言） */
type PowerUserLike = {
  default_persona: string | null;
  personas: Record<string, string>;
  persona_descriptions: Record<string, { connections?: Array<{ id?: string }> }>;
};

const mutablePowerUser = power_user as unknown as PowerUserLike;

/** TavernHelper 全局注入（persona 兜底读取用） */
interface GlobalTavernHelper {
  getCurrentPersonaName?: () => string | null;
  getCurrentPersonaId?: () => string | null;
  getTavernHelperVersion?: () => string;
}

beforeEach(() => {
  // 重置 shared 状态（mock 是模块级 const，需逐个清字段）
  chat_metadata.persona = undefined;
  mutablePowerUser.default_persona = null;
  mutablePowerUser.personas = {};
  mutablePowerUser.persona_descriptions = {};
  const global = globalThis as { TavernHelper?: GlobalTavernHelper };
  global.TavernHelper = {
    getTavernHelperVersion: () => '99.0.0',
    getCurrentPersonaName: () => null,
    getCurrentPersonaId: () => null,
  };
});

describe('prompt-profiles-context', () => {
  it('getCurrentCharacterKey reads name2', () => {
    // name2 mock 为 ''
    expect(getCurrentCharacterKey()).toBeNull();
  });

  it('uses chat-locked persona (chat_metadata.persona) first, regardless of live persona', () => {
    chat_metadata.persona = 'locked-persona';
    (globalThis as { TavernHelper?: GlobalTavernHelper }).TavernHelper = {
      getTavernHelperVersion: () => '99.0.0',
      getCurrentPersonaName: () => 'stale-persona',
      getCurrentPersonaId: () => 'stale-id',
    };
    expect(getCurrentUserPersonaKey()).toBe('locked-persona');
  });

  it('uses default persona when set', () => {
    mutablePowerUser.default_persona = 'default-persona';
    mutablePowerUser.personas = { 'default-persona': '默认人设' };
    // 默认人设分支返回 persona id（key），不转显示名；显示名仅在"连接人设"分支解析
    expect(getCurrentUserPersonaKey()).toBe('default-persona');
  });

  it('falls back to the live current persona only when no lock/connection/default', () => {
    (globalThis as { TavernHelper?: GlobalTavernHelper }).TavernHelper = {
      getTavernHelperVersion: () => '99.0.0',
      getCurrentPersonaName: () => 'live-persona',
      getCurrentPersonaId: () => 'live-id',
    };
    expect(getCurrentUserPersonaKey()).toBe('live-persona');
  });
});
