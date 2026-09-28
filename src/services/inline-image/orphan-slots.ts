/**
 * 位点绑定清理的纯规划逻辑
 *
 * 失效绑定码 = 聊天正文里的位点短码 `⟦cv:slotId⟧`,但其 slot 已无任何图片可依:
 * - 正向孤儿:活动 swipe 正文有短码,却无临时图 / 无收藏 / 非生成中 → 从正文剥离
 * - 反向孤儿:当前作用域临时图的 slot 未被任何 swipe 短码引用 → 删除残留临时图
 *
 * 本模块只做集合运算,所有 ST / IndexedDB 访问由调用方注入,便于单测。
 */

/** 一枚待清除的失效短码在某楼层的引用 */
export interface OrphanShortcodeRef {
  slotId: string;
  messageId: number;
}

/** 一条临时图记录的清理判定所需字段 */
export interface TemporaryImageSlotRef {
  id: string;
  slotId: string;
}

/** 位点绑定扫描输入(全部为纯数据) */
export interface SlotBindingScanInput {
  /** 活动 swipe 正文里的短码引用,是正向清除的目标 */
  activeReferences: OrphanShortcodeRef[];
  /** 全部 swipe(含非活动)引用到的 slotId,用于反向孤儿保护 */
  referencedSlotIds: Iterable<string>;
  /** 当前作用域的临时图记录 */
  temporaryImages: TemporaryImageSlotRef[];
  /** 当前作用域存有收藏的 slotId */
  favoriteSlotIds: Iterable<string>;
  /** 正在生成 / 已挂载 runtime 的 slotId(双向保护) */
  liveSlotIds: Iterable<string>;
}

/** 位点绑定清理计划 */
export interface SlotBindingCleanupPlan {
  /** 待从正文剥离的失效短码 */
  orphanShortcodes: OrphanShortcodeRef[];
  /** 待删除的反向孤儿临时图 id */
  orphanTemporaryImageIds: string[];
}

/** 清理计划的计数摘要,用于确认弹窗与结果提示 */
export interface SlotBindingCleanupSummary {
  /** 失效短码枚数 */
  orphanShortcodeCount: number;
  /** 涉及楼层数 */
  affectedMessageCount: number;
  /** 反向孤儿临时图张数 */
  orphanTemporaryImageCount: number;
}

/**
 * 依据扫描输入规划失效绑定码清理
 * @param input 位点绑定扫描输入
 * @returns 清理计划
 */
export function planSlotBindingCleanup(input: SlotBindingScanInput): SlotBindingCleanupPlan {
  const temporarySlotIds = new Set(input.temporaryImages.map(record => record.slotId));
  const favoriteSlotIds = new Set(input.favoriteSlotIds);
  const liveSlotIds = new Set(input.liveSlotIds);
  // 活动正文里的短码同样算「被引用」，避免其临时图被误判为反向孤儿
  const referencedSlotIds = new Set(input.referencedSlotIds);
  for (const ref of input.activeReferences) referencedSlotIds.add(ref.slotId);

  // 正向孤儿:活动正文有短码,但无临时图、无收藏、且非生成中
  const orphanShortcodes = input.activeReferences.filter(
    ref =>
      !temporarySlotIds.has(ref.slotId) &&
      !favoriteSlotIds.has(ref.slotId) &&
      !liveSlotIds.has(ref.slotId),
  );

  // 反向孤儿:临时图的 slot 未被任何 swipe 短码引用,且非生成中
  const orphanTemporaryImageIds = input.temporaryImages
    .filter(record => !referencedSlotIds.has(record.slotId) && !liveSlotIds.has(record.slotId))
    .map(record => record.id);

  return { orphanShortcodes, orphanTemporaryImageIds };
}

/**
 * 汇总清理计划的计数
 * @param plan 清理计划
 * @returns 计数摘要
 */
export function summarizeSlotBindingCleanup(plan: SlotBindingCleanupPlan): SlotBindingCleanupSummary {
  const affectedMessages = new Set(plan.orphanShortcodes.map(ref => ref.messageId));
  return {
    orphanShortcodeCount: plan.orphanShortcodes.length,
    affectedMessageCount: affectedMessages.size,
    orphanTemporaryImageCount: plan.orphanTemporaryImageIds.length,
  };
}

/**
 * 计划是否无任何可清理项
 * @param summary 计数摘要
 * @returns 是否为空计划
 */
export function isSlotBindingCleanupEmpty(summary: SlotBindingCleanupSummary): boolean {
  return summary.orphanShortcodeCount === 0 && summary.orphanTemporaryImageCount === 0;
}
