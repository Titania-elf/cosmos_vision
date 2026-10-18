import { NPC_LIBRARY_GLOBAL_GROUP, NPC_SUPPORTING_ROLE_RULES, type NpcLibraryEntry } from '@/constants/npc-library';
import { canFillNpcAppearance } from './first-appearance';

/** 随主聊天请求发送简短规则与身份名单，不重复发送整份 NPC 外观档案。 */
export function buildNpcAutoCreatePrompt(entries: NpcLibraryEntry[], group: string, excludeNames: string[]): string {
  const scoped = entries.filter(entry => entry.group === group || entry.group === NPC_LIBRARY_GLOBAL_GROUP);
  const identity = (entry: NpcLibraryEntry) => ({ name: entry.name, aliases: entry.aliases });
  const needsAppearance = (entry: NpcLibraryEntry) => entry.group === group && canFillNpcAppearance(entry);
  const roster = {
    excluded: excludeNames,
    registered: scoped.filter(entry => !needsAppearance(entry)).map(identity),
    awaitingAppearance: scoped.filter(needsAppearance).map(identity),
  };
  return `配角首次出场建档：正常写正文，仅在本条回复实际出场的人物被明确判断为尚未建档的配角，或待补全配角有了明确身体外观描写时，才追加隐藏记录。
${NPC_SUPPORTING_ROLE_RULES}
使用正文中明确的姓名或稳定独有称呼，姓名与别名代表同一人物，不重复建档。
只记录正文或已有资料明确支持的身体外观：发色、发长、发型、瞳色、肤色、身高、体型、面部特征、年龄外观、种族、兽耳、尾巴、角等。不得根据姓名、职业或性格猜测特征。
appearanceTags 与 appearanceNote 都不得含服装（包括常穿/标志性服饰）、鞋袜、内衣、盔甲、帽子、眼镜、首饰、发饰、配饰、武器或持物，也不得含动作、表情、姿势、裸露、临时伤污、光影等状态。服装记录由其他规则独立处理。
已确认是配角但首次出场没有身体外观描写时，只记录姓名与别名，两个外观字段留空；不能给尚未确认的路人先建姓名档案。awaitingAppearance 配角等有了明确外观再补全；registered 人物无须重复输出，不能通过换别名重建档案。
appearanceTags 用英文小写绘画标签，空格分词、英文逗号分隔；appearanceNote 仅补充标签表达不了的身体细节，没有则留空。
仅在确有新建或补全时于回复末尾追加一个 HTML 注释，内容为合法 JSON，不用 Markdown 代码围栏，不在正文/状态栏展示。没有变化时不要输出任何 NPC 注释或空数组。字符串中的 < 和 > 使用 JSON Unicode 转义。
<!-- cv-npcs {"npcs":[{"name":"配角姓名","role":"supporting","aliases":[],"appearanceTags":"","appearanceNote":""}]} -->
当前故事名单（excluded 为不可建档人物，registered 为已有档案，awaitingAppearance 为待补全）：
${JSON.stringify(roster).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')}`;
}
