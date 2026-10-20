import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/constants/default-settings';
import { createPromptLlmAccount, type PromptLlmSettings } from '@/constants/prompt-llm';
import type { TavernHelperGenerateRawConfig } from '@/services/tavern-helper/prompt-llm';
import { translateText } from '@/services/translation/text-translation';

/**
 * 构建带一个可用账号的提示词 LLM 设置
 * @returns 提示词 LLM 设置
 */
function createSettings(): PromptLlmSettings {
  const account = {
    ...createPromptLlmAccount('account-1', 'https://example.com/v1', 'sk-test', '测试账号'),
    source: 'openai',
    model: 'test-model',
  };
  return { ...DEFAULT_SETTINGS.promptLlm, accounts: [account] };
}

/**
 * 注入带指定回复的 TavernHelper 替身
 * @param reply generateRaw 返回文本
 * @returns generateRaw 监视器
 */
function stubTavernHelper(reply: string) {
  const generateRaw = vi.fn(async (_request: TavernHelperGenerateRawConfig) => reply);
  vi.stubGlobal('TavernHelper', {
    getTavernHelperVersion: () => '4.8.13',
    substitudeMacros: (text: string) => text,
    generateRaw,
  });
  return generateRaw;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateText 中英互译', () => {
  it('中译英请求携带系统指令与原文，并返回译文', async () => {
    const generateRaw = stubTavernHelper('1girl, smile');

    const result = await translateText('一个女孩，微笑', 'zh-en', createSettings());

    expect(result).toBe('1girl, smile');
    const request = generateRaw.mock.calls[0]![0];
    expect(request.ordered_prompts).toHaveLength(2);
    expect(request.ordered_prompts![0]).toMatchObject({ role: 'system' });
    const userPrompt = request.ordered_prompts![1] as { role: string; content: string };
    expect(userPrompt.role).toBe('user');
    expect(userPrompt.content).toContain('一个女孩，微笑');
    expect(userPrompt.content).toContain('英文');
    expect(request.custom_api?.model).toBe('test-model');
  });

  it('英译中时要求翻译成中文', async () => {
    const generateRaw = stubTavernHelper('一个女孩，微笑');

    const result = await translateText('1girl, smile', 'en-zh', createSettings());

    expect(result).toBe('一个女孩，微笑');
    const request = generateRaw.mock.calls[0]![0];
    const userPrompt = request.ordered_prompts![1] as { content: string };
    expect(userPrompt.content).toContain('中文');
  });

  it('清理代码块、字段名前缀与整体引号', async () => {
    stubTavernHelper('```\n英文："1girl, smile"\n```');

    const result = await translateText('一个女孩，微笑', 'zh-en', createSettings());

    expect(result).toBe('1girl, smile');
  });

  it('空文本直接返回空串且不发起请求', async () => {
    const generateRaw = stubTavernHelper('不应被调用');

    const result = await translateText('   ', 'zh-en', createSettings());

    expect(result).toBe('');
    expect(generateRaw).not.toHaveBeenCalled();
  });

  it('酒馆助手不可用时抛出中文错误', async () => {
    vi.stubGlobal('TavernHelper', undefined);

    await expect(translateText('一个女孩', 'zh-en', createSettings())).rejects.toThrow('酒馆助手不可用');
  });
});
