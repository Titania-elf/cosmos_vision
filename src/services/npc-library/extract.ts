import type { PromptLlmSettings } from '@/constants/novelai';
import { normalizeNpcAliases } from '@/constants/npc-library';
import { requestPromptLlmWithAccounts } from '@/services/prompt-llm/runtime-request';
import { getTavernHelper } from '@/services/tavern-helper/availability';
import {
  buildCustomApi,
  buildGenerateRawMessagesRequest,
  extractOutputBlock,
  type TavernHelperJsonSchema,
  type TavernHelperRolePrompt,
} from '@/services/tavern-helper/prompt-llm';

/** LLM 抽取出的单个 NPC 候选 */
export interface NpcExtractionCandidate {
  name: string;
  aliases: string[];
  appearanceTags: string;
  appearanceNote: string;
}

/** NPC 抽取选项 */
export interface NpcExtractionOptions {
  /** 需排除的名字(主角、用户 persona 等,不当作 NPC) */
  excludeNames?: string[];
}

/**
 * 从聊天文本抽取 NPC 外观候选
 * 复用 Prompt LLM 账号与故障转移,使用独立的多 NPC 抽取提示词与 JSON schema
 * @param contextText 聊天文本(焦点段落 + 历史)
 * @param settings Prompt LLM 配置
 * @param options 抽取选项
 * @returns NPC 候选列表(已排除主角/用户与空 tag 项)
 */
export async function extractNpcCandidates(
  contextText: string,
  settings: PromptLlmSettings,
  options: NpcExtractionOptions = {},
): Promise<NpcExtractionCandidate[]> {
  const source = contextText.trim();
  if (!source) return [];
  const tavernHelper = getTavernHelper({ silent: false });
  if (!tavernHelper) throw new Error('TavernHelper 不可用，无法扫描 NPC');
  const excludeNames = options.excludeNames ?? [];
  const prompts = buildNpcExtractionPrompts(source, excludeNames);
  try {
    const result = await requestPromptLlmWithAccounts(tavernHelper, settings, {}, account =>
      Promise.resolve(buildGenerateRawMessagesRequest(prompts, buildCustomApi(account), buildNpcExtractionSchema(), false)),
    );
    return parseNpcExtractionResult(result.rawText, excludeNames);
  } catch (error) {
    throw new Error(`NPC 扫描失败: ${(error as Error).message}`);
  }
}

/**
 * 构建 NPC 抽取消息列表
 * @param passage 聊天文本
 * @param excludeNames 需排除的名字
 * @returns 有序消息列表
 */
function buildNpcExtractionPrompts(passage: string, excludeNames: string[]): TavernHelperRolePrompt[] {
  const excludeLine = excludeNames.filter(Boolean).length
    ? `以下名字是主角或用户本人，绝对不要当作 NPC 输出：${excludeNames.filter(Boolean).join('、')}。`
    : '当前没有额外需要排除的主角名。';
  const system = [
    '你是一个从角色扮演/小说文本中提取"配角(NPC)长期外观设定"的助手。',
    '任务：在给定文本里找出被具名描述了外观的次要人物，为每个人物输出可用于二次元绘画的 danbooru 风格标签。',
    excludeLine,
    '硬规则：',
    '1. 只提取"长期外观锚点"：发色、发型、瞳色、肤色、体型、种族/兽耳等固有特征，以及该角色的标志性/常穿服饰。',
    '2. 绝不提取"临时状态"：当前动作、姿势、表情、一次性的持物、临时受伤/脏污、场景光影——这些不属于长期外观。',
    '3. 标签全小写、用普通空格分词(如 silver hair)，严禁连字符与下划线；多个标签用英文逗号加空格分隔。',
    '4. 名字用文本中出现的原名；aliases 填该角色的其他称呼/别名(没有就空数组)。',
    '5. 找不到任何有外观描写的 NPC 时，输出空数组。不要臆造、不要把主角或用户填进去。',
    '6. appearanceNote 只在标签实在表达不了时补一句极简英文描述，否则留空字符串。',
    '输出：仅输出一个 JSON 对象，用 <output></output> 标签完整包裹，形如：',
    '<output>{"npcs":[{"name":"...","aliases":["..."],"appearanceTags":"tag, tag","appearanceNote":""}]}</output>',
  ].join('\n');
  const user = [`请从下面的文本中提取 NPC 长期外观：`, '', passage].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * 构建 NPC 抽取 JSON schema
 * @returns TavernHelper JSON schema
 */
function buildNpcExtractionSchema(): TavernHelperJsonSchema {
  return {
    name: 'cosmos_vision_npc_extraction',
    description: 'NPC 长期外观提取结果',
    strict: true,
    value: {
      type: 'object',
      properties: {
        npcs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              aliases: { type: 'array', items: { type: 'string' } },
              appearanceTags: { type: 'string' },
              appearanceNote: { type: 'string' },
            },
            required: ['name', 'aliases', 'appearanceTags', 'appearanceNote'],
            additionalProperties: false,
          },
        },
      },
      required: ['npcs'],
      additionalProperties: false,
    },
  };
}

/**
 * 解析 NPC 抽取返回文本
 * @param rawText LLM 原始响应
 * @param excludeNames 需排除的名字
 * @returns 规范化后的候选列表
 */
export function parseNpcExtractionResult(rawText: string, excludeNames: string[] = []): NpcExtractionCandidate[] {
  const clean = extractOutputBlock(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('NPC 扫描返回值不是有效 JSON');
  }
  const npcs = (parsed as { npcs?: unknown })?.npcs;
  if (!Array.isArray(npcs)) return [];
  const excluded = new Set(excludeNames.map(name => name.trim().toLowerCase()).filter(Boolean));
  return npcs.flatMap(item => normalizeCandidate(item, excluded));
}

/**
 * 规范化单个候选(坏数据/主角/空 tag 丢弃)
 * @param value 原始候选
 * @param excluded 排除名字集合(小写)
 * @returns 单元素数组或空数组
 */
function normalizeCandidate(value: unknown, excluded: Set<string>): NpcExtractionCandidate[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (!name || excluded.has(name.toLowerCase())) return [];
  const appearanceTags = typeof record.appearanceTags === 'string' ? record.appearanceTags.trim() : '';
  if (!appearanceTags) return [];
  return [
    {
      name,
      aliases: Array.isArray(record.aliases)
        ? normalizeNpcAliases(record.aliases.filter((alias): alias is string => typeof alias === 'string'))
        : [],
      appearanceTags,
      appearanceNote: typeof record.appearanceNote === 'string' ? record.appearanceNote.trim() : '',
    },
  ];
}
