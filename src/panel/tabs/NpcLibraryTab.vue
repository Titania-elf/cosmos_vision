<template>
  <div class="cv-tab-content flex flex-col gap-0">
    <div class="mt-(--cv-space-5xl) flex flex-col gap-(--cv-space-4xl)">
      <div class="flex flex-col gap-(--cv-space-lg)">
        <label class="cv-field">
          <span>分组筛选</span>
          <Select v-model="groupFilter" :options="groupFilterOptions" option-label="label" option-value="value" fluid />
        </label>
        <div class="flex gap-(--cv-space-sm)">
          <Button label="新建 NPC" icon="fa-solid fa-user-plus" outlined class="flex-1" @click="createBlankNpc" />
          <Button
            label="从当前聊天导入"
            icon="fa-solid fa-file-import"
            outlined
            class="flex-1"
            @click="importFromChatProfiles"
          />
        </div>
        <Button
          label="从当前聊天扫描外观"
          icon="fa-solid fa-wand-magic-sparkles"
          :loading="scanning"
          class="w-full"
          @click="runScan"
        />
        <div class="flex flex-col gap-(--cv-space-sm) rounded-(--cv-radius-sm) bg-(--cv-surface-container-low) p-(--cv-space-lg)">
          <label class="flex items-center justify-between gap-(--cv-space-md) text-(length:--cv-font-size-xs)">
            <span>生图时自动注入命中的 NPC</span>
            <CvMiniToggleSwitch v-model="useNpcLibrary" aria-label="自动注入 NPC" />
          </label>
          <label class="flex items-center justify-between gap-(--cv-space-md) text-(length:--cv-font-size-xs)">
            <span>AI 回复后后台自动更新库<br /><span class="text-(--cv-on-surface-variant)">消耗额外 LLM 请求，默认关闭</span></span>
            <CvMiniToggleSwitch v-model="autoUpdateNpcLibrary" aria-label="后台自动更新 NPC 库" />
          </label>
        </div>
      </div>

      <div v-if="filteredEntries.length > 0" class="flex flex-col gap-(--cv-space-xl)">
        <CollapsiblePanelItem
          v-for="entry in filteredEntries"
          :key="entry.id"
          :title="entry.name || '未命名 NPC'"
          :collapsed="entry.id !== activeEntryId"
          :disabled="entry.enabled === false"
          :is-editing="editingEntryId === entry.id"
          @toggle="toggleEntry(entry.id)"
        >
          <template #title>
            <div
              v-if="editingEntryId === entry.id"
              class="flex h-full min-w-0 flex-1 items-center gap-(--cv-space-md)"
              @click.stop
              @keydown.stop
              @keyup.stop
            >
              <InputText
                v-model="editingDraft"
                class="h-8 min-w-0 flex-1"
                size="small"
                autofocus
                @click.stop
                @keydown.enter.stop.prevent="finishEditing(entry)"
                @keydown.esc.stop.prevent="finishEditing(entry)"
              />
              <CvMiniButton icon="fa-regular fa-check" aria-label="完成" @click.stop="finishEditing(entry)" />
            </div>
            <div v-else class="flex h-full min-w-0 items-center gap-(--cv-space-sm)">
              <span
                class="block min-w-0 flex-[0_1_auto] overflow-hidden text-(length:--cv-font-size-xs) font-semibold text-ellipsis whitespace-nowrap text-(--cv-on-surface)"
              >
                {{ entry.name || '未命名 NPC' }}
              </span>
              <span class="cv-npc-group-chip">{{ getNpcGroupLabel(entry.group) }}</span>
              <CvMiniButton icon="fa-regular fa-pen" aria-label="重命名" @click.stop="toggleEditing(entry)" />
            </div>
          </template>
          <template #actions>
            <CvMiniToggleSwitch v-model="entry.enabled" aria-label="启用 NPC" />
            <CvMiniButton icon="fa-regular fa-trash" tone="danger" aria-label="删除 NPC" @click="deleteNpc(entry)" />
          </template>

          <section class="flex flex-col gap-(--cv-space-5xl)">
            <label class="cv-field">
              <span>分组</span>
              <Select
                v-model="entry.group"
                :options="entryGroupOptions"
                option-label="label"
                option-value="value"
                fluid
              />
            </label>

            <label class="cv-field">
              <span>触发模式</span>
              <Select
                v-model="entry.insertMode"
                :options="INSERT_MODE_OPTIONS"
                option-label="label"
                option-value="value"
                fluid
              />
            </label>

            <div v-if="entry.insertMode === 'keyword'" class="cv-field">
              <span>触发关键词 / 别名</span>
              <div class="cv-field-control">
                <InputTags v-model="entry.aliases" :allow-duplicate="false" add-on-blur delimiter="," fluid />
                <div class="cv-field-hint">聊天里提到这些词才注入该 NPC；NPC 名本身也会自动作为触发词</div>
              </div>
            </div>

            <div class="cv-field">
              <span>外观固定 tag</span>
              <div class="cv-field-control">
                <CvExpandableTextarea v-model="entry.staticTags" rows="3" auto-resize class="w-full font-mono" />
                <div class="cv-field-hint">长期外观锚点（发色、瞳色、体型、标志性服饰），会原样注入并强调保留</div>
              </div>
            </div>

            <label class="cv-field">
              <span>外观补充说明（可选）</span>
              <div class="cv-field-control">
                <CvExpandableTextarea v-model="entry.appearanceNote" rows="2" auto-resize class="w-full" />
                <div class="cv-field-hint">标签表达不了的外观细节，作为自然语言补充</div>
              </div>
            </label>

            <div class="flex flex-wrap items-center justify-between gap-(--cv-space-md)">
              <label class="flex items-center gap-(--cv-space-sm) text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
                <CvMiniToggleSwitch v-model="entry.locked" aria-label="锁定" />
                <span>锁定（不被自动更新覆盖）</span>
              </label>
              <CvMiniButton
                label="导入到当前聊天"
                icon="fa-regular fa-file-export"
                @click="importToChat(entry)"
              />
            </div>
          </section>
        </CollapsiblePanelItem>
      </div>
      <section
        v-else
        class="flex min-h-64 flex-col justify-center gap-(--cv-space-lg) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid border-(--cv-surface-variant) bg-(--cv-surface-container-low) p-(--cv-space-5xl) text-center text-(--cv-on-surface-variant)"
      >
        <i class="fa-solid fa-users-viewfinder" />
        <span>{{ emptyStateText }}</span>
        <span class="text-(length:--cv-font-size-xs)">NPC 库跨聊天保存，命中当前故事时会自动注入生图提示词</span>
      </section>
    </div>
    <NpcScanDialog v-model:visible="scanDialogVisible" :plans="scanPlans" @apply="applyScanPlans" />
  </div>
</template>
<script setup lang="ts">
import CollapsiblePanelItem from '@/panel/components/CollapsiblePanelItem.vue';
import CvExpandableTextarea from '@/panel/components/CvExpandableTextarea.vue';
import CvMiniButton from '@/panel/components/CvMiniButton.vue';
import CvMiniToggleSwitch from '@/panel/components/CvMiniToggleSwitch.vue';
import NpcScanDialog from '@/panel/components/NpcScanDialog.vue';
import { event_types, eventSource } from '@sillytavern/script';
import {
  NPC_LIBRARY_GLOBAL_GROUP,
  NPC_SCAN_FLOOR_COUNT,
  createNpcLibraryEntry,
  getNpcGroupLabel,
  type NpcLibraryEntry,
} from '@/constants/npc-library';
import type { PromptPersonInsertMode } from '@/constants/novelai';
import { scanNpcCandidatesFromCurrentChat } from '@/services/npc-library/scan';
import { applyNpcMergePlans, planNpcMerges, type NpcMergePlan } from '@/services/npc-library/merge';
import { useSettingsStore } from '@/store/settings';
import { npcEntryToPromptPerson } from '@/services/prompt-profiles/runtime';
import { promptPersonToNpcEntry } from '@/services/npc-library/convert';
import { persistChatProfiles, readChatProfiles } from '@/services/prompt-profiles/chat-store';
import { getCurrentCharacterKey } from '@/services/tavern-helper/prompt-profiles-context';

type ShowConfirm = (options: {
  title?: string;
  message: string;
  acceptLabel?: string;
  cancelLabel?: string;
  severity?: string;
}) => Promise<boolean>;

const INSERT_MODE_OPTIONS: Array<{ label: string; value: PromptPersonInsertMode }> = [
  { label: '始终触发', value: 'always' },
  { label: '关键词触发', value: 'keyword' },
];

/** 克隆库条目为普通对象(剥离响应式,库条目均为 JSON 安全数据) */
function cloneEntries(entries: NpcLibraryEntry[]): NpcLibraryEntry[] {
  return JSON.parse(JSON.stringify(entries));
}

const settingsStore = useSettingsStore();
const showConfirm = inject<ShowConfirm>('showConfirm');

// 本地工作副本；库即时落盘：任何深度变更后立即写回已应用配置(与 LoRA 预设一致)
const entries = ref<NpcLibraryEntry[]>(cloneEntries(settingsStore.savedSettings.npcLibrary.entries));
watch(entries, value => settingsStore.applyNpcLibrarySettings({ entries: cloneEntries(value) }), { deep: true });

const currentGroupKey = ref<string | null>(getCurrentCharacterKey());
const refreshCurrentGroup = (): void => {
  currentGroupKey.value = getCurrentCharacterKey();
};
eventSource.on(event_types.CHAT_CHANGED, refreshCurrentGroup);
onUnmounted(() => eventSource.removeListener(event_types.CHAT_CHANGED, refreshCurrentGroup));

const groupFilter = ref<string>('all');
const activeEntryId = ref<string | null>(null);
const editingEntryId = ref<string | null>(null);
const editingDraft = ref('');

const scanning = ref(false);
const scanDialogVisible = ref(false);
const scanPlans = ref<NpcMergePlan[]>([]);

// NPC 库两个开关即时生效（不走设置草稿）
const useNpcLibrary = computed({
  get: () => settingsStore.savedSettings.promptLlm.useNpcLibrary,
  set: value => settingsStore.applyNpcLibraryToggles({ useNpcLibrary: value }),
});
const autoUpdateNpcLibrary = computed({
  get: () => settingsStore.savedSettings.promptLlm.autoUpdateNpcLibrary,
  set: value => settingsStore.applyNpcLibraryToggles({ autoUpdateNpcLibrary: value }),
});

/** 库中出现过的分组 ∪ 当前故事组 ∪ 通用组 */
const knownGroups = computed(() => {
  const groups = new Set<string>();
  entries.value.forEach(entry => groups.add(entry.group));
  if (currentGroupKey.value) groups.add(currentGroupKey.value);
  groups.add(NPC_LIBRARY_GLOBAL_GROUP);
  return Array.from(groups);
});

const groupFilterOptions = computed(() => [
  { label: '全部分组', value: 'all' },
  ...knownGroups.value.map(group => ({ label: getNpcGroupLabel(group), value: group })),
]);

const entryGroupOptions = computed(() =>
  knownGroups.value.map(group => ({ label: getNpcGroupLabel(group), value: group })),
);

const filteredEntries = computed(() =>
  groupFilter.value === 'all' ? entries.value : entries.value.filter(entry => entry.group === groupFilter.value),
);

/** 新建/导入的默认落点分组：已筛选具体分组时用它，否则当前故事组，再否则通用组 */
const defaultTargetGroup = computed(() => {
  if (groupFilter.value !== 'all') return groupFilter.value;
  return currentGroupKey.value ?? NPC_LIBRARY_GLOBAL_GROUP;
});

const emptyStateText = computed(() =>
  groupFilter.value === 'all'
    ? '还没有任何 NPC，点击上方按钮新建，或从当前聊天档案导入'
    : `分组「${getNpcGroupLabel(groupFilter.value)}」下还没有 NPC`,
);
/**
 * 从当前聊天扫描 NPC 外观并生成合并方案，弹出确认弹窗
 */
async function runScan(): Promise<void> {
  if (scanning.value) return;
  scanning.value = true;
  try {
    const candidates = await scanNpcCandidatesFromCurrentChat(settingsStore.savedSettings.promptLlm, NPC_SCAN_FLOOR_COUNT);
    if (!candidates.length) {
      toastr.info('没有从当前聊天里识别到可入库的 NPC');
      return;
    }
    scanPlans.value = planNpcMerges(candidates, entries.value, defaultTargetGroup.value);
    scanDialogVisible.value = true;
  } catch (error) {
    toastr.error((error as Error).message || 'NPC 扫描失败');
  } finally {
    scanning.value = false;
  }
}

/**
 * 应用扫描确认弹窗里勾选的合并方案
 */
function applyScanPlans(): void {
  const merged = applyNpcMergePlans(scanPlans.value, entries.value, '聊天扫描');
  const changed = merged.length - entries.value.length;
  entries.value = merged;
  scanDialogVisible.value = false;
  toastr.success(changed > 0 ? `已写入 ${changed} 个新 NPC，并更新已有条目` : '已按扫描结果更新 NPC 库');
}

/**
 * 折叠/展开指定 NPC 面板
 * @param id 条目 id
 */
function toggleEntry(id: string): void {
  activeEntryId.value = activeEntryId.value === id ? null : id;
}

/**
 * 进入重命名态
 * @param entry 目标条目
 */
function toggleEditing(entry: NpcLibraryEntry): void {
  editingEntryId.value = entry.id;
  editingDraft.value = entry.name;
}

/**
 * 结束重命名并写入名称
 * @param entry 目标条目
 */
function finishEditing(entry: NpcLibraryEntry): void {
  const name = editingDraft.value.trim();
  if (name) entry.name = name;
  editingEntryId.value = null;
}

/**
 * 新建空白 NPC 并进入编辑
 */
function createBlankNpc(): void {
  const entry = createNpcLibraryEntry('新 NPC', defaultTargetGroup.value);
  entries.value.unshift(entry);
  activeEntryId.value = entry.id;
  toggleEditing(entry);
}

/**
 * 删除 NPC（有确认弹窗时先确认）
 * @param entry 目标条目
 */
async function deleteNpc(entry: NpcLibraryEntry): Promise<void> {
  const confirmed = showConfirm
    ? await showConfirm({
        title: '删除 NPC',
        message: `确定删除「${entry.name || '未命名 NPC'}」吗？`,
        acceptLabel: '删除',
        severity: 'danger',
      })
    : true;
  if (!confirmed) return;
  entries.value = entries.value.filter(item => item.id !== entry.id);
}

/**
 * 把库条目导入到当前聊天的人物档案（库 → 聊天，同名跳过）
 * @param entry 目标条目
 */
function importToChat(entry: NpcLibraryEntry): void {
  const person = npcEntryToPromptPerson(entry);
  const existing = readChatProfiles();
  if (existing.some(item => item.name.trim() === person.name.trim())) {
    toastr.info(`当前聊天已有同名档案「${person.name}」`);
    return;
  }
  persistChatProfiles([...existing, person]);
  toastr.success(`已将「${person.name}」导入当前聊天档案`);
}

/**
 * 从当前聊天的角色档案导入到库（聊天 → 库，同组同名跳过）
 */
function importFromChatProfiles(): void {
  const targetGroup = defaultTargetGroup.value;
  const profiles = readChatProfiles().filter(person => person.kind === 'character');
  if (!profiles.length) {
    toastr.info('当前聊天没有可导入的角色档案');
    return;
  }
  const existingKeys = new Set(entries.value.map(entry => `${entry.group}\u0000${entry.name.trim().toLowerCase()}`));
  const imported = profiles
    .filter(person => !existingKeys.has(`${targetGroup}\u0000${person.name.trim().toLowerCase()}`))
    .map(person => promptPersonToNpcEntry(person, targetGroup));
  if (!imported.length) {
    toastr.info('没有新的角色可导入（同组同名已存在）');
    return;
  }
  entries.value = [...imported, ...entries.value];
  toastr.success(`已从当前聊天导入 ${imported.length} 个 NPC 到分组「${getNpcGroupLabel(targetGroup)}」`);
}
</script>

<style scoped>
.cv-npc-group-chip {
  flex: none;
  padding: 0 var(--cv-space-sm);
  border-radius: var(--cv-radius-xs, 4px);
  font-size: var(--cv-font-size-xs);
  color: var(--cv-on-surface-variant);
  background: var(--cv-surface-container-high, var(--cv-surface-container-low));
  white-space: nowrap;
}
</style>
