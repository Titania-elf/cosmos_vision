export const extension_settings: Record<string, unknown> = {};

/** 测试用聊天元数据（各用例自行填充，模拟 ST chatMetadata） */
const testChatMetadata: Record<string, unknown> = {};

/** 测试用 getContext：返回最小 ST context 形状 */
export function getContext(): { chatMetadata: Record<string, unknown>; saveMetadataDebounced: () => void } {
  return { chatMetadata: testChatMetadata, saveMetadataDebounced: () => {} };
}
