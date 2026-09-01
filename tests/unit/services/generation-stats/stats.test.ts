import { describe, expect, it } from 'vitest';

import { MAX_GENERATION_STATS_RECORDS, type ImageGenerationRecord } from '@/constants/generation-stats';
import {
  appendGenerationRecord,
  computeGenerationStats,
  formatGenerationDuration,
  parseStoredGenerationStats,
} from '@/services/generation-stats/stats';

function createRecord(overrides: Partial<ImageGenerationRecord> = {}): ImageGenerationRecord {
  return {
    id: `record-${Math.random().toString(36).slice(2)}`,
    source: 'novelai',
    startedAt: Date.now(),
    durationMs: 1000,
    imageCount: 1,
    success: true,
    ...overrides,
  };
}

describe('parseStoredGenerationStats', () => {
  it('returns empty array for non-array values', () => {
    expect(parseStoredGenerationStats(undefined)).toEqual([]);
    expect(parseStoredGenerationStats(null)).toEqual([]);
    expect(parseStoredGenerationStats('not-an-array')).toEqual([]);
  });

  it('keeps valid records and drops corrupt entries', () => {
    const valid = createRecord();
    const result = parseStoredGenerationStats([
      valid,
      { id: 'bad', source: 'unknown-source', startedAt: 1, durationMs: 1, imageCount: 1, success: true },
      { id: 123 },
      'garbage',
    ]);
    expect(result).toEqual([valid]);
  });
});

describe('appendGenerationRecord', () => {
  it('appends the record to the end', () => {
    const first = createRecord({ id: 'first' });
    const second = createRecord({ id: 'second' });
    const result = appendGenerationRecord([first], second);
    expect(result).toEqual([first, second]);
  });

  it('does not mutate the original list', () => {
    const first = createRecord({ id: 'first' });
    const original = [first];
    appendGenerationRecord(original, createRecord());
    expect(original).toEqual([first]);
  });

  it('caps the list and drops the oldest records', () => {
    const records = Array.from({ length: MAX_GENERATION_STATS_RECORDS }, (_, index) =>
      createRecord({ id: `record-${index}` }),
    );
    const newest = createRecord({ id: 'newest' });
    const result = appendGenerationRecord(records, newest);
    expect(result).toHaveLength(MAX_GENERATION_STATS_RECORDS);
    expect(result[0]).toEqual(records[1]);
    expect(result.at(-1)).toEqual(newest);
  });
});

describe('computeGenerationStats', () => {
  it('returns zeroed summary with null durations for empty records', () => {
    const stats = computeGenerationStats([]);
    expect(stats.overall).toEqual({ total: 0, success: 0, failure: 0, averageMs: null, fastestMs: null, slowestMs: null });
    expect(stats.bySource.novelai.total).toBe(0);
    expect(stats.bySource.comfyui.total).toBe(0);
  });

  it('computes duration stats over successful records only', () => {
    const stats = computeGenerationStats([
      createRecord({ success: true, durationMs: 1000 }),
      createRecord({ success: true, durationMs: 3000 }),
      createRecord({ success: false, durationMs: 60000, imageCount: 0, errorMessage: 'timeout' }),
    ]);
    expect(stats.overall.total).toBe(3);
    expect(stats.overall.success).toBe(2);
    expect(stats.overall.failure).toBe(1);
    expect(stats.overall.averageMs).toBe(2000);
    expect(stats.overall.fastestMs).toBe(1000);
    expect(stats.overall.slowestMs).toBe(3000);
  });

  it('buckets records by source', () => {
    const stats = computeGenerationStats([
      createRecord({ source: 'novelai', durationMs: 1000 }),
      createRecord({ source: 'comfyui', durationMs: 5000 }),
      createRecord({ source: 'comfyui', durationMs: 7000 }),
    ]);
    expect(stats.bySource.novelai.total).toBe(1);
    expect(stats.bySource.novelai.averageMs).toBe(1000);
    expect(stats.bySource.comfyui.total).toBe(2);
    expect(stats.bySource.comfyui.fastestMs).toBe(5000);
    expect(stats.bySource.comfyui.slowestMs).toBe(7000);
    expect(stats.overall.total).toBe(3);
  });
});

describe('formatGenerationDuration', () => {
  it('formats milliseconds, seconds and minutes', () => {
    expect(formatGenerationDuration(830)).toBe('830 ms');
    expect(formatGenerationDuration(12400)).toBe('12.4 s');
    expect(formatGenerationDuration(151000)).toBe('2分31秒');
  });
});
