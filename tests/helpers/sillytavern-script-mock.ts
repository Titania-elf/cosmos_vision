export const saveSettingsDebounced = () => {};

/** 测试用聊天数组（各用例自行填充/清空，模拟 ST 全局 chat） */
export const chat: unknown[] = [];

/** 测试用当前聊天 ID */
const currentChatId = 'test-chat';
export function getCurrentChatId(): string {
  return currentChatId;
}

/** chat_metadata mock（人物档案 per-chat 存储用） */
export const chat_metadata: Record<string, unknown> = {};

/** 防抖保存聊天 mock */
export const saveChatDebounced = () => {};

/** 当前角色显示名（prompt-profiles-context 读取） */
export const name2 = '';

/** 当前角色索引（prompt-profiles-context 读取角色卡绑定 key 用） */
export const this_chid = -1;

/** 角色卡列表 mock */
export const characters: Array<{ name?: string; avatar?: string }> = [];


type EventListener = (...args: unknown[]) => void;

/** 测试用事件总线：模拟 ST eventSource 的 on/emit/removeListener/makeLast */
class MockEventSource {
  private listeners = new Map<string, Set<EventListener>>();

  on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  once(event: string, listener: EventListener): void {
    const wrapped: EventListener = (...args) => {
      this.removeListener(event, wrapped);
      listener(...args);
    };
    this.on(event, wrapped);
  }

  removeListener(event: string, listener: EventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** ST 的 makeLast：移除后重挂（测试中重挂一次即可） */
  makeLast(event: string, listener: EventListener): void {
    this.removeListener(event, listener);
    this.on(event, listener);
  }

  /** 触发事件（测试驱动用） */
  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(listener => listener(...args));
  }
}

export const eventSource = new MockEventSource();

/** 测试用事件名常量（对齐 ST script.js 的 event_types） */
export const event_types = {
  MORE_MESSAGES_LOADED: 'more_messages_loaded',
  MESSAGE_DELETED: 'message_deleted',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  USER_MESSAGE_RENDERED: 'user_message_rendered',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_SWIPED: 'message_swiped',
} as const;
