import type { PromptLlmSettings } from '@/constants/prompt-llm';
import { requestPromptLlmWithAccounts } from '@/services/prompt-llm/runtime-request';
import { getOptionalTavernHelper } from '@/services/tavern-helper/availability';
import {
  buildCustomApi,
  buildGenerateRawMessagesRequest,
  type TavernHelperRolePrompt,
} from '@/services/tavern-helper/prompt-llm';

/** 翻译方向：中译英 / 英译中 */
export type TranslationDirection = 'zh-en' | 'en-zh';

/**
 * 生图提示词翻译系统指令
 * 保留标签语法与占位符，便于译文直接回填生图提示词
 */
const TRANSLATION_SYSTEM_PROMPT = [
  '你是 AI 生图提示词的中英互译引擎，只做翻译，不回答或解释。',
  '输出要求：',
  '1. 只输出译文本身，不要添加引号、代码块、前缀或说明。',
  '2. 保留原文的换行、逗号分隔、括号权重（如 (smile:1.2)）、LoRA 标记（如 <lora:name:0.8>）、BREAK 以及 {{...}} 占位符，不要翻译或改写它们。',
  '3. 中文译为英文时使用 Danbooru / NovelAI 风格的英文标签词。',
  '4. 英文译为中文时逐项翻译，保持标签顺序与分隔符不变，不要增删内容。',
].join('\n');

/**
 * 构建翻译请求消息
 * @param text 待翻译文本
 * @param direction 翻译方向
 * @returns system 与 user 消息
 */
function buildTranslationMessages(text: string, direction: TranslationDirection): TavernHelperRolePrompt[] {
  const targetLanguage = direction === 'zh-en' ? '英文' : '中文';
  return [
    { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
    { role: 'user', content: `将 <text> 标签内的文本翻译成${targetLanguage}：\n<text>\n${text}\n</text>` },
  ];
}

/**
 * 清理模型可能附带的代码块、标签回声、字段名前缀与整体引号
 * @param raw 模型原始输出
 * @returns 可直接回填的译文
 */
function sanitizeTranslation(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n?```$/);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/^<text>\s*/i, '').replace(/\s*<\/text>$/i, '').trim();
  text = text.replace(/^(?:翻译|译文|英文|中文|translation|english|chinese)\s*[:：]\s*/i, '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('“') && text.endsWith('”'))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

/**
 * 使用已配置的提示词 LLM 账号做中英互译
 * 复用账号故障转移能力；不经过提示词预设，避免预设指令干扰翻译
 * @param text 待翻译文本
 * @param direction 翻译方向
 * @param settings 提示词 LLM 设置（账号与超时）
 * @returns 清洗后的译文
 */
export async function translateText(
  text: string,
  direction: TranslationDirection,
  settings: PromptLlmSettings,
): Promise<string> {
  const source = text.trim();
  if (!source) return '';
  const tavernHelper = getOptionalTavernHelper();
  if (!tavernHelper) throw new Error('酒馆助手不可用，无法翻译');

  const messages = buildTranslationMessages(source, direction);
  const { rawText } = await requestPromptLlmWithAccounts(
    tavernHelper,
    settings,
    {},
    async account => buildGenerateRawMessagesRequest(messages, buildCustomApi(account)),
  );
  return sanitizeTranslation(rawText);
}
