import { describe, expect, it } from 'vitest';
import {
  isSlotBindingCleanupEmpty,
  planSlotBindingCleanup,
  summarizeSlotBindingCleanup,
  type SlotBindingScanInput,
} from '@/services/inline-image/orphan-slots';

/**
 * 构造扫描输入，未指定字段取空集
 * @param overrides 覆盖字段
 * @returns 扫描输入
 */
function makeInput(overrides: Partial<SlotBindingScanInput>): SlotBindingScanInput {
  return {
    activeReferences: [],
    referencedSlotIds: [],
    temporaryImages: [],
    favoriteSlotIds: [],
    liveSlotIds: [],
    ...overrides,
  };
}

describe('inline-image orphan-slots', () => {
  it('flags active shortcodes with no temp / favorite / live backing as forward orphans', () => {
    const plan = planSlotBindingCleanup(
      makeInput({
        activeReferences: [
          { slotId: 'aaaaaaaa', messageId: 3 },
          { slotId: 'bbbbbbbb', messageId: 5 },
        ],
        temporaryImages: [{ id: 't1', slotId: 'aaaaaaaa' }],
      }),
    );
    expect(plan.orphanShortcodes).toEqual([{ slotId: 'bbbbbbbb', messageId: 5 }]);
    expect(plan.orphanTemporaryImageIds).toEqual([]);
  });

  it('protects shortcodes backed by favorites or live runtimes', () => {
    const plan = planSlotBindingCleanup(
      makeInput({
        activeReferences: [
          { slotId: 'favfavfa', messageId: 1 },
          { slotId: 'livelive', messageId: 2 },
        ],
        favoriteSlotIds: ['favfavfa'],
        liveSlotIds: ['livelive'],
      }),
    );
    expect(plan.orphanShortcodes).toEqual([]);
  });

  it('flags temp images referenced by no swipe shortcode as reverse orphans', () => {
    const plan = planSlotBindingCleanup(
      makeInput({
        referencedSlotIds: ['aaaaaaaa'],
        temporaryImages: [
          { id: 't1', slotId: 'aaaaaaaa' },
          { id: 't2', slotId: 'orphanid' },
        ],
      }),
    );
    expect(plan.orphanTemporaryImageIds).toEqual(['t2']);
  });

  it('keeps temp images still referenced by an inactive swipe shortcode', () => {
    const plan = planSlotBindingCleanup(
      makeInput({
        // 活动正文未引用，但某条非活动 swipe 仍引用 → referencedSlotIds 命中
        referencedSlotIds: ['swiperef'],
        temporaryImages: [{ id: 't1', slotId: 'swiperef' }],
      }),
    );
    expect(plan.orphanTemporaryImageIds).toEqual([]);
  });

  it('protects live temp images from reverse cleanup', () => {
    const plan = planSlotBindingCleanup(
      makeInput({
        temporaryImages: [{ id: 't1', slotId: 'livelive' }],
        liveSlotIds: ['livelive'],
      }),
    );
    expect(plan.orphanTemporaryImageIds).toEqual([]);
  });

  it('summarizes counts and distinct affected messages', () => {
    const summary = summarizeSlotBindingCleanup({
      orphanShortcodes: [
        { slotId: 'aaaaaaaa', messageId: 4 },
        { slotId: 'bbbbbbbb', messageId: 4 },
        { slotId: 'cccccccc', messageId: 9 },
      ],
      orphanTemporaryImageIds: ['t1', 't2'],
    });
    expect(summary).toEqual({
      orphanShortcodeCount: 3,
      affectedMessageCount: 2,
      orphanTemporaryImageCount: 2,
    });
    expect(isSlotBindingCleanupEmpty(summary)).toBe(false);
  });

  it('reports empty plans', () => {
    const summary = summarizeSlotBindingCleanup({ orphanShortcodes: [], orphanTemporaryImageIds: [] });
    expect(isSlotBindingCleanupEmpty(summary)).toBe(true);
  });
});
