/**
 * power_user 模拟（prompt-profiles-context 读取人设连接/默认人设用）
 * 测试中通过 vi.mock 或全局注入使用，默认空态即可
 */
export const power_user: {
  default_persona: string | null;
  personas: Record<string, string>;
  persona_descriptions: Record<string, { description?: string; connections?: Array<{ id?: string }> }>;
} = {
  default_persona: null,
  personas: {},
  persona_descriptions: {},
};
