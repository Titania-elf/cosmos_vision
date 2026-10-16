export interface OutfitUpdate {
  name: string;
  /** 完整穿着快照；每次更新整体替换，空字符串表示明确没有穿戴。 */
  outfit: string;
  /** 从本消息第几段开始生效，第一段为 1。 */
  fromParagraph: number;
  /** 换装生效处的正文原句，用于 HTML 气泡等段落边界不同的场景。 */
  fromText?: string;
}

export interface OutfitRecord extends OutfitUpdate {
  messageIndex: number;
}

export interface OutfitContinuitySettings {
  enabled: boolean;
  prompt: string;
}

export const DEFAULT_OUTFIT_CONTINUITY_PROMPT = `维护本聊天主角和本次出场配角的服装连续性。正常写正文，不要把记录作为正文、状态栏或代码块展示。
首次出场：优先采用正文、人物资料中已有的穿着；确实没有资料时，允许按当前场景补出合理穿着，此后保持连续。
后续出场：延续上一份记录，只有换装、脱穿、衣物损坏或剧情明确改变穿戴状态时才更新，不能每轮凭空换衣。
每份 outfit 用自然语言写出完整的当前穿着，包括衣服、鞋袜、配饰、颜色及穿戴状态。更新整体替换旧快照，未变部分也要保留；脱掉的衣物不要继续列作穿着。明确没有任何穿戴时写“未穿戴衣物或配饰”。
使用稳定的人物姓名，与人物资料一致；本次未出场的人物不用重复输出。
同一回复中换装时，分别记录起始穿着与换装后的穿着。fromParagraph 是开始生效的正文段落编号，从 1 起算，空行分隔正文段落；fromText 填开始生效处的一句正文原文（首次建立记录可省略），不要引用之后才发生的剧情。已有记录没有变化时无需重复。
在回复末尾只追加一个隐藏 HTML 注释，格式必须是合法 JSON，不要用 Markdown 代码围栏：
<!-- cv-outfits {"updates":[{"name":"人物姓名","outfit":"完整穿着描述","fromParagraph":1},{"name":"人物姓名","outfit":"换装后的完整穿着","fromParagraph":4,"fromText":"换装生效处的正文原句"}]} -->
没有新记录或变化时输出 <!-- cv-outfits {"updates":[]} -->。`;
