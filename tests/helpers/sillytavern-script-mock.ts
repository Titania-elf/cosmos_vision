export const saveSettingsDebounced = () => {};

/** chat_metadata mock（人物档案 per-chat 存储用） */
export const chat_metadata: Record<string, unknown> = {};

/** 保存当前聊天 mock */
export const saveChatDebounced = () => {};

/** 测试用聊天消息数组（chat-dom 经此读取楼层消息） */
export const chat: Array<{
  mes: string;
  is_user?: boolean;
  is_system?: boolean;
  swipes?: string[];
  swipe_id?: number;
}> = [];

export const getCurrentChatId = () => 'test-chat';
export const extension_prompt_types = { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
export const extension_prompts: Record<string, { value: string; position: number; depth: number }> = {};
export function setExtensionPrompt(key: string, value: string, position: number, depth: number): void {
  extension_prompts[key] = { value, position, depth };
}

type EventListener = (...args: unknown[]) => void;

/** 测试用事件总线：模拟 ST eventSource 的 on/emit/removeListener */
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

  /** 触发事件（测试驱动用） */
  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach(listener => listener(...args));
  }
}

export const eventSource = new MockEventSource();
export const event_types: Record<string, string> = {
  CHAT_CHANGED: 'chat_id_changed',
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_UPDATED: 'message_updated',
  MESSAGE_SWIPED: 'message_swiped',
  MESSAGE_DELETED: 'message_deleted',
  CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped',
};
