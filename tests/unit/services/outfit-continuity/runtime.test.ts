import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as st from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';
import {
  buildImageOutfitContext,
  installOutfitHiddenRegex,
  readOutfitContinuitySettings,
  saveManualOutfitUpdate,
  saveOutfitContinuitySettings,
  startOutfitContinuity,
} from '@/services/outfit-continuity/runtime';
import { appendOutfitUpdate, parseOutfitUpdates } from '@/services/outfit-continuity/timeline';
import { buildPromptLlmOrderedPrompts } from '@/services/prompt-llm/runtime-request';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { buildPromptLlmContextFromParagraphs } from '@/services/sillytavern/chat-dom';
import { buildFrontendPromptContext } from '@/composables/inlineImageGenerationRequests';

vi.mock('@sillytavern/script', async importOriginal => ({
  ...(await importOriginal<object>()),
  getCurrentChatId: vi.fn(() => 'chat-a'),
  saveChatDebounced: vi.fn(),
  setExtensionPrompt: vi.fn(),
}));

const message = (outfit: string) => ({
  mes: appendOutfitUpdate('她走进房间。\n\n她坐下。', { name: '小明', outfit, fromParagraph: 1 }),
  is_user: false,
});
const injectedValue = () => vi.mocked(st.setExtensionPrompt).mock.calls.at(-1)?.[1];

beforeEach(() => {
  st.chat.length = 0;
  for (const key of Object.keys(st.chat_metadata)) delete (st.chat_metadata as Record<string, unknown>)[key];
  vi.mocked(st.getCurrentChatId).mockReturnValue('chat-a');
  st.eventSource.emit(st.event_types.CHAT_CHANGED);
});

describe('服装连续性接入', () => {
  it('默认关闭，按聊天保存开关与提示词，切聊天清除旧注入', () => {
    startOutfitContinuity();
    expect(readOutfitContinuitySettings().enabled).toBe(false);
    saveOutfitContinuitySettings({ enabled: true, prompt: '维护服装' });
    expect(injectedValue()).toContain('维护服装');
    expect(st.saveChatDebounced).toHaveBeenCalled();
    delete (st.chat_metadata as Record<string, unknown>).cosmos_vision_outfit_continuity;
    vi.mocked(st.getCurrentChatId).mockReturnValue('chat-b');
    st.eventSource.emit(st.event_types.CHAT_CHANGED);
    expect(readOutfitContinuitySettings().enabled).toBe(false);
    expect(injectedValue()).toBe('');
  });

  it('重生成排除被替换回复的穿着，删除该消息后不再多排除一层', () => {
    startOutfitContinuity();
    st.chat.push(message('校服'), { mes: '继续', is_user: true }, message('睡衣'));
    saveOutfitContinuitySettings({ enabled: true, prompt: '维护' });
    st.eventSource.emit(st.event_types.GENERATION_AFTER_COMMANDS, 'regenerate');
    expect(injectedValue()).toContain('校服');
    expect(injectedValue()).not.toContain('睡衣');
    st.chat.pop();
    st.eventSource.emit(st.event_types.MESSAGE_DELETED, 2);
    expect(injectedValue()).toContain('校服');
    st.chat.push(message('泳衣'));
    st.eventSource.emit(st.event_types.GENERATION_ENDED);
    expect(injectedValue()).toContain('泳衣');
  });

  it('quiet 和 impersonate 不注入维护要求，结束后恢复', () => {
    startOutfitContinuity();
    saveOutfitContinuitySettings({ enabled: true, prompt: '维护' });
    for (const type of ['quiet', 'impersonate']) {
      st.eventSource.emit(st.event_types.GENERATION_AFTER_COMMANDS, type);
      expect(injectedValue()).toBe('');
      st.eventSource.emit(st.event_types.GENERATION_ENDED);
      expect(injectedValue()).toBe('维护');
    }
  });

  it('手动纠正只写入当前 swipe，并保留正文短码', () => {
    const first = message('校服').mes + '\n⟦cv:abcd1234⟧';
    const alternate = message('睡衣').mes;
    st.chat.push({ mes: first, is_user: false, swipes: [first, alternate], swipe_id: 0 });
    saveManualOutfitUpdate(0, { name: '小明', outfit: '校服、黑袜', fromParagraph: 1 });
    expect(st.chat[0]!.mes).toContain('⟦cv:abcd1234⟧');
    expect(st.chat[0]!.swipes![0]).toBe(st.chat[0]!.mes);
    expect(st.chat[0]!.swipes![1]).toBe(alternate);
    expect(parseOutfitUpdates(st.chat[0]!.mes)).toHaveLength(2);
    expect(() => saveManualOutfitUpdate(5, { name: '小明', outfit: '校服', fromParagraph: 1 })).toThrow('有效的 AI');
  });

  it('隐藏规则幂等，只作用于显示和 prompt，不删除存储记录', () => {
    installOutfitHiddenRegex();
    installOutfitHiddenRegex();
    const scripts = extension_settings.regex.filter(script => script.id === 'cosmos-vision-outfits-hidden');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ markdownOnly: true, promptOnly: true, placement: [2] });
  });

  it('没有焦点消息的外部请求不套用最新穿着；关闭开关仍可读历史记录', () => {
    st.chat.push(message('校服'), message('睡衣'));
    const context = { historyParagraphs: [], focusParagraph: '她走进房间。', specialRequest: '' };
    expect(buildImageOutfitContext({ ...context, messageIndex: null })).toBe('');
    const content = buildImageOutfitContext({ ...context, messageIndex: 0, paragraphIndex: 1 });
    expect(content).toContain('校服');
    expect(content).not.toContain('睡衣');
  });

  it('DOM 焦点带上消息、段落和截至焦点的正文以读取换装', async () => {
    st.chat.push(message('校服'));
    st.chat[0]!.mes = appendOutfitUpdate(st.chat[0]!.mes, {
      name: '小明',
      outfit: '睡衣',
      fromParagraph: 2,
      fromText: '她坐下。',
    });
    document.body.innerHTML = '<div mesid="0"><div class="mes_text"><p>她走进房间。</p><p>她坐下。</p></div></div>';
    const paragraphs = [...document.querySelectorAll<HTMLElement>('p')];
    const first = await buildPromptLlmContextFromParagraphs([paragraphs[0]!], {
      historyFloorCount: 0,
      ignoreUserMessagesInHistory: true,
    });
    expect(first.paragraphIndex).toBe(1);
    expect(buildImageOutfitContext(first)).toContain('校服');
    expect(buildImageOutfitContext(first)).not.toContain('睡衣');
    const second = await buildPromptLlmContextFromParagraphs([paragraphs[1]!], {
      historyFloorCount: 0,
      ignoreUserMessagesInHistory: true,
    });
    expect(second.paragraphIndex).toBe(2);
    expect(buildImageOutfitContext(second)).toContain('睡衣');
  });

  it('即使用户预设没有 participants 宏，服装快照也独立进入生图提示词请求', async () => {
    const prompts = await buildPromptLlmOrderedPrompts(DEFAULT_SETTINGS.promptLlmMessagePresets, {
      historyContent: '正文',
      participantContent: '',
      focusParagraphContent: '焦点',
      specialRequestContent: '',
      outfitContent: '目标段落穿着：校服',
    });
    expect(prompts.at(-1)).toEqual({ role: 'system', content: '目标段落穿着：校服' });
  });

  it('前端气泡生图路径携带焦点消息，按原句读取气泡里的换装', async () => {
    st.chat.push(message('校服'));
    st.chat[0]!.mes = appendOutfitUpdate(st.chat[0]!.mes, {
      name: '小明',
      outfit: '睡衣',
      fromParagraph: 2,
      fromText: '她坐下。',
    });
    document.body.innerHTML =
      '<div mesid="0"><div class="mes_text"><div class="custom-bubble">她走进房间。</div><div class="custom-bubble">她坐下。</div></div></div>';
    const bubbles = [...document.querySelectorAll<HTMLElement>('.custom-bubble')];
    const first = await buildFrontendPromptContext([bubbles[0]!], DEFAULT_SETTINGS.promptLlm);
    expect(first.messageIndex).toBe(0);
    expect(buildImageOutfitContext(first)).toContain('校服');
    expect(buildImageOutfitContext(first)).not.toContain('睡衣');
    const second = await buildFrontendPromptContext([bubbles[1]!], DEFAULT_SETTINGS.promptLlm);
    expect(buildImageOutfitContext(second)).toContain('睡衣');
  });
});
