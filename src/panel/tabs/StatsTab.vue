<template>
  <div class="flex flex-col gap-0">
    <!-- 总体统计 -->
    <h2 class="cv-section-title">总体统计</h2>
    <div class="cv-section-body">
      <div class="grid grid-cols-2 gap-(--cv-space-md) md:grid-cols-3">
        <div v-for="tile in overallTiles" :key="tile.label" class="cv-stat-tile">
          <span class="text-(length:--cv-font-size-sm) text-(--cv-on-surface-variant)">{{ tile.label }}</span>
          <span class="text-(length:--cv-font-size-xl) font-(--cv-font-headline)" :class="tile.class">{{
            tile.value
          }}</span>
        </div>
      </div>
      <div class="cv-field-hint mt-(--cv-space-md)">
        耗时统计(平均/最快/最慢)仅基于成功记录,失败多为超时请求;每次重试计为一次新记录,用户取消不计入。
      </div>
    </div>

    <!-- 按图像源统计 -->
    <h2 class="cv-section-title">按图像源统计</h2>
    <div class="cv-section-body flex flex-col gap-(--cv-space-lg)">
      <div v-for="item in sourceItems" :key="item.label" class="flex flex-col gap-(--cv-space-sm)">
        <Tag :value="item.label" severity="primary" rounded class="w-fit" />
        <div class="grid grid-cols-2 gap-(--cv-space-md) md:grid-cols-3">
          <div v-for="tile in item.tiles" :key="tile.label" class="cv-stat-tile">
            <span class="text-(length:--cv-font-size-sm) text-(--cv-on-surface-variant)">{{ tile.label }}</span>
            <span class="text-(length:--cv-font-size-xl) font-(--cv-font-headline)" :class="tile.class">{{
              tile.value
            }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 最近记录 -->
    <StaticPanel title="最近记录">
      <template #actions>
        <Button
          icon="fa-solid fa-trash-can"
          label="清空"
          size="small"
          variant="outlined"
          severity="danger"
          :disabled="recentRecords.length === 0"
          @click="confirmClearRecords"
        />
      </template>
      <div v-if="recentRecords.length === 0" class="py-(--cv-space-xl) text-center text-(--cv-on-surface-variant)">
        暂无生图记录
      </div>
      <div v-else class="flex flex-col">
        <div
          v-for="record in recentRecords"
          :key="record.id"
          class="flex flex-wrap items-center gap-(--cv-space-md) border-b border-(--cv-outline-variant) py-(--cv-space-sm) last:border-b-0"
        >
          <span class="w-fit shrink-0 text-(length:--cv-font-size-sm) text-(--cv-on-surface-variant)">
            {{ formatGenerationTimestamp(record.startedAt) }}
          </span>
          <Tag :value="record.source === 'comfyui' ? 'ComfyUI' : 'NovelAI'" severity="secondary" rounded />
          <span class="font-(--cv-font-headline)">{{ formatGenerationDuration(record.durationMs) }}</span>
          <span class="text-(length:--cv-font-size-sm) text-(--cv-on-surface-variant)">{{ record.imageCount }} 张</span>
          <i
            :class="record.success ? 'fa-solid fa-circle-check text-(--cvp-green-500)' : 'fa-solid fa-circle-xmark text-(--cvp-red-500)'"
            :title="record.success ? '成功' : '失败'"
          />
          <span
            v-if="record.errorMessage"
            class="min-w-0 flex-1 truncate text-(length:--cv-font-size-sm) text-(--cvp-red-500)"
            :title="record.errorMessage"
          >
            {{ record.errorMessage }}
          </span>
        </div>
      </div>
    </StaticPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue';
import { storeToRefs } from 'pinia';

import { IMAGE_SOURCES } from '@/constants/comfyui';
import StaticPanel from '@/panel/components/StaticPanel.vue';
import {
  formatGenerationDuration,
  formatGenerationTimestamp,
  type GenerationStatsSummary,
} from '@/services/generation-stats/stats';
import { useGenerationStatsStore } from '@/store/generation-stats';

/** 统计指标瓦片 */
interface StatsTile {
  label: string;
  value: string;
  class?: string;
}

const statsStore = useGenerationStatsStore();
const { summary, recentRecords } = storeToRefs(statsStore);

const showConfirm =
  inject<
    (options: {
      title?: string;
      message: string;
      acceptLabel?: string;
      cancelLabel?: string;
      severity?: string;
    }) => Promise<boolean>
  >('showConfirm');

/** 总体统计瓦片 */
const overallTiles = computed<StatsTile[]>(() => buildSummaryTiles(summary.value.overall));

/** 按图像源统计瓦片 */
const sourceItems = computed(() =>
  IMAGE_SOURCES.map(({ value, label }) => ({
    label,
    tiles: buildSummaryTiles(summary.value.bySource[value]),
  })),
);

/**
 * 组装单组摘要的展示瓦片
 * @param stats 摘要数据
 * @returns 瓦片列表
 */
function buildSummaryTiles(stats: GenerationStatsSummary): StatsTile[] {
  return [
    { label: '总次数', value: String(stats.total) },
    { label: '成功', value: String(stats.success) },
    { label: '失败', value: String(stats.failure), class: stats.failure > 0 ? 'text-(--cvp-red-500)' : undefined },
    { label: '平均耗时', value: formatDurationOrDash(stats.averageMs) },
    { label: '最快', value: formatDurationOrDash(stats.fastestMs) },
    { label: '最慢', value: formatDurationOrDash(stats.slowestMs) },
  ];
}

/**
 * 格式化耗时,空值显示占位符
 * @param ms 耗时毫秒
 * @returns 展示文案
 */
function formatDurationOrDash(ms: number | null): string {
  return ms === null ? '—' : formatGenerationDuration(ms);
}

/**
 * 确认清空全部生图统计记录
 */
async function confirmClearRecords(): Promise<void> {
  if (!showConfirm) {
    statsStore.clearRecords();
    return;
  }
  const confirmed = await showConfirm({
    title: '清空统计',
    message: '确定要清空全部生图统计记录吗？此操作不可恢复。',
    acceptLabel: '清空',
    cancelLabel: '取消',
    severity: 'danger',
  });
  if (confirmed) statsStore.clearRecords();
}
</script>

<style scoped>
.cv-stat-tile {
  display: flex;
  flex-direction: column;
  gap: var(--cv-space-sm);
  padding: var(--cv-space-md) var(--cv-space-lg);
  border-radius: var(--cv-radius-md, 0.5rem);
  background: var(--cv-surface-container, rgba(127, 127, 127, 0.08));
}
</style>
