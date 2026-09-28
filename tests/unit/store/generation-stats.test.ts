import { describe, expect, it, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import { GENERATION_STATS_STORAGE_KEY } from '@/constants/generation-stats';
import { useGenerationStatsStore } from '@/store/generation-stats';
import type { InlineGenerationBatchResult } from '@/composables/inlineGenerationInput';

function createBatchResult(imageCount = 1): InlineGenerationBatchResult {
  return {
    imageBlobs: Array.from({ length: imageCount }, () => new Blob(['image'])),
    promptSnapshot: {} as InlineGenerationBatchResult['promptSnapshot'],
  };
}

describe('useGenerationStatsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('records a successful generation with image count', async () => {
    const store = useGenerationStatsStore();
    const controller = new AbortController();
    const result = await store.recordGeneration('novelai', controller.signal, async () => createBatchResult(2));

    expect(result.imageBlobs).toHaveLength(2);
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({ source: 'novelai', imageCount: 2, success: true });
    expect(store.summary.overall).toMatchObject({ total: 1, success: 1, failure: 0 });
  });

  it('records a failed generation and rethrows the original error', async () => {
    const store = useGenerationStatsStore();
    const controller = new AbortController();
    const error = new Error('生成失败');

    await expect(
      store.recordGeneration('comfyui', controller.signal, async () => {
        throw error;
      }),
    ).rejects.toThrow('生成失败');

    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({ source: 'comfyui', success: false, imageCount: 0, errorMessage: '生成失败' });
    expect(store.summary.overall.failure).toBe(1);
  });

  it('skips recording when the session was aborted by the user', async () => {
    const store = useGenerationStatsStore();
    const controller = new AbortController();
    controller.abort();

    await expect(
      store.recordGeneration('novelai', controller.signal, async () => {
        throw new Error('The user aborted a request.');
      }),
    ).rejects.toThrow();

    expect(store.records).toHaveLength(0);
  });

  it('persists records to localStorage and restores them', async () => {
    const store = useGenerationStatsStore();
    const controller = new AbortController();
    await store.recordGeneration('novelai', controller.signal, async () => createBatchResult());
    await nextTick();

    const stored = localStorage.getItem(GENERATION_STATS_STORAGE_KEY);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toHaveLength(1);

    // 新 pinia + 新 store 实例模拟页面刷新后恢复
    setActivePinia(createPinia());
    const reloaded = useGenerationStatsStore();
    expect(reloaded.records).toHaveLength(1);
    expect(reloaded.records[0].source).toBe('novelai');
  });

  it('exposes recent records newest first', async () => {
    const store = useGenerationStatsStore();
    const controller = new AbortController();
    await store.recordGeneration('novelai', controller.signal, async () => createBatchResult());
    await store.recordGeneration('comfyui', controller.signal, async () => createBatchResult());

    expect(store.records.map(record => record.source)).toEqual(['novelai', 'comfyui']);
    expect(store.recentRecords.map(record => record.source)).toEqual(['comfyui', 'novelai']);
  });

  it('clears records and storage', async () => {
    const store = useGenerationStatsStore();
    const controller = new AbortController();
    await store.recordGeneration('novelai', controller.signal, async () => createBatchResult());
    await nextTick();

    store.clearRecords();
    await nextTick();

    expect(store.records).toHaveLength(0);
    expect(store.summary.overall.total).toBe(0);
    expect(localStorage.getItem(GENERATION_STATS_STORAGE_KEY)).toBe('[]');
  });
});
