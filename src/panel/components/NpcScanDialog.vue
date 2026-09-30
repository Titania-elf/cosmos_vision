<template>
  <Dialog
    v-model:visible="visible"
    modal
    :draggable="false"
    header="从聊天扫描 NPC 外观"
    :style="{ width: '34rem', maxWidth: 'calc(100dvw - 2rem)' }"
  >
    <div v-if="plans.length === 0" class="py-(--cv-space-4xl) text-center text-(--cv-on-surface-variant)">
      没有从当前聊天里识别到可入库的 NPC
    </div>
    <div v-else class="flex flex-col gap-(--cv-space-lg)">
      <p class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
        勾选要写入库的项，可直接编辑标签。锁定与无变化的项默认不勾选。
      </p>
      <div
        v-for="(plan, index) in plans"
        :key="`${plan.group}-${plan.name}-${index}`"
        class="flex flex-col gap-(--cv-space-sm) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid border-(--cv-surface-variant) p-(--cv-space-lg)"
      >
        <div class="flex items-center gap-(--cv-space-md)">
          <Checkbox v-model="plan.accepted" binary :disabled="isPlanLocked(plan)" :input-id="`npc-plan-${index}`" />
          <label :for="`npc-plan-${index}`" class="flex min-w-0 flex-1 items-center gap-(--cv-space-sm)">
            <span class="truncate font-semibold text-(--cv-on-surface)">{{ plan.name }}</span>
            <span class="cv-npc-kind-chip" :data-kind="plan.kind">{{ kindLabel(plan.kind) }}</span>
          </label>
        </div>
        <CvExpandableTextarea
          v-model="plan.mergedTags"
          rows="2"
          auto-resize
          class="w-full font-mono"
          :disabled="isPlanLocked(plan)"
        />
        <div v-if="plan.newTags.length" class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
          新增：{{ plan.newTags.join(', ') }}
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-(--cv-space-sm)">
        <Button label="取消" text @click="visible = false" />
        <Button
          :label="`应用（${acceptedCount}）`"
          icon="fa-solid fa-check"
          :disabled="acceptedCount === 0"
          @click="emit('apply')"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import CvExpandableTextarea from '@/panel/components/CvExpandableTextarea.vue';
import type { NpcMergeKind, NpcMergePlan } from '@/services/npc-library/merge';

const visible = defineModel<boolean>('visible', { default: false });
const props = defineProps<{ plans: NpcMergePlan[] }>();
const emit = defineEmits<{ apply: [] }>();

const KIND_LABELS: Record<NpcMergeKind, string> = {
  create: '新建',
  update: '更新',
  'skip-locked': '锁定跳过',
  unchanged: '无变化',
};

const acceptedCount = computed(
  () => props.plans.filter(plan => plan.accepted && (plan.kind === 'create' || plan.kind === 'update')).length,
);

/**
 * 读取合并类型的中文标签
 * @param kind 合并类型
 * @returns 展示标签
 */
function kindLabel(kind: NpcMergeKind): string {
  return KIND_LABELS[kind];
}

/**
 * 判断该项是否锁定不可编辑
 * @param plan 合并方案
 * @returns 是否锁定
 */
function isPlanLocked(plan: NpcMergePlan): boolean {
  return plan.kind === 'skip-locked';
}
</script>

<style scoped>
.cv-npc-kind-chip {
  flex: none;
  padding: 0 var(--cv-space-sm);
  border-radius: var(--cv-radius-xs, 4px);
  font-size: var(--cv-font-size-xs);
  color: var(--cv-on-surface-variant);
  background: var(--cv-surface-container-high, var(--cv-surface-container-low));
}
.cv-npc-kind-chip[data-kind='create'] {
  color: var(--cvp-primary-color);
}
</style>
