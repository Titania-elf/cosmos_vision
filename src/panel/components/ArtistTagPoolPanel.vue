<template>
  <h2 class="cv-section-title">画师串池</h2>
  <div class="cv-section-body">
    <div class="cv-field">
      <div class="cv-field-control">
        <label class="cv-field-inline" style="margin-bottom: 0">
          <span>随机注入画师串</span>
          <ToggleSwitch v-model="pool.enabled" />
        </label>
        <div class="cv-field-hint">
          开启后每次生图从已启用的条目中随机抽取 1 条，拼接在正向提示词最前面；NovelAI 与 ComfyUI 通用。点击条目可编辑。
        </div>
        <div class="flex justify-end">
          <input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="handleImportFileChange"
          />
          <Button
            icon="fa-regular fa-file-import"
            label="导入 JSON"
            size="small"
            variant="outlined"
            severity="secondary"
            title="导入画师串 JSON"
            aria-label="导入画师串 JSON"
            @click="openImportFilePicker"
          />
        </div>
      </div>
    </div>

    <div class="cv-field p-0!">
      <CollapsiblePanelItem
        title="画师串条目"
        :collapsed="isEntryListCollapsed"
        @toggle="isEntryListCollapsed = !isEntryListCollapsed"
      >
        <template #title-extra>
          <Tag :value="entryCountLabel" severity="secondary" rounded class="shrink-0 leading-none" />
        </template>

        <template #actions>
          <Button
            icon="fa-solid fa-plus"
            label="新增画师串"
            size="small"
            variant="outlined"
            severity="secondary"
            title="新增画师串"
            @click="addEntry"
          />
        </template>

        <PromptEntryList v-model="pool.entries" empty-text="暂无画师串">
          <template #main="{ entry }">
            <button
              type="button"
              class="flex min-w-0 flex-1 cursor-pointer items-center gap-(--cv-space-xl) rounded-(--cv-radius-sm) bg-transparent p-0 text-left transition-colors duration-150 hover:text-(--cvp-primary-color)"
              title="编辑画师串"
              :aria-label="`编辑 ${getEntryTitle(entry as ArtistTagEntry)}`"
              @click="openEntryEditor(entry as ArtistTagEntry)"
            >
              <span class="flex min-w-0 flex-1 flex-col items-start justify-center gap-(--cv-space-2xs)">
                <span
                  class="max-w-full truncate font-semibold text-(--cv-on-surface)"
                  :title="getEntryTitle(entry as ArtistTagEntry)"
                >
                  {{ getEntryTitle(entry as ArtistTagEntry) }}
                </span>
                <span
                  class="max-w-full truncate text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
                  :title="getEntryText(entry as ArtistTagEntry)"
                >
                  {{ getEntryText(entry as ArtistTagEntry) }}
                </span>
              </span>
              <Tag v-if="!entry.enabled" value="停用" severity="secondary" rounded class="shrink-0 leading-none" />
            </button>
          </template>

          <template #actions="{ entry }">
            <CvMiniToggleSwitch
              v-model="(entry as ArtistTagEntry).enabled"
              :aria-label="`${getEntryTitle(entry as ArtistTagEntry)} 启用状态`"
            />
            <CvMiniButton
              icon="fa-regular fa-pen"
              title="编辑画师串"
              :aria-label="`编辑 ${getEntryTitle(entry as ArtistTagEntry)}`"
              @click="openEntryEditor(entry as ArtistTagEntry)"
            />
            <CvMiniButton
              icon="fa-regular fa-trash"
              tone="danger"
              title="删除画师串"
              :aria-label="`删除 ${getEntryTitle(entry as ArtistTagEntry)}`"
              @click="removeEntry((entry as ArtistTagEntry).id)"
            />
          </template>
        </PromptEntryList>
      </CollapsiblePanelItem>
    </div>
  </div>

  <Dialog
    v-model:visible="isEditorVisible"
    modal
    dismissable-mask
    header="编辑画师串"
    :style="{ width: 'min(32rem, calc(100vw - 2rem))' }"
    @hide="closeEntryEditor"
  >
    <div v-if="editorDraft" class="flex flex-col gap-(--cv-space-3xl)">
      <label class="cv-field">
        <span>名称</span>
        <InputText v-model="editorDraft.name" placeholder="名称（仅用于识别）" class="w-full min-w-0" aria-label="画师串名称" />
      </label>
      <label class="cv-field">
        <span>画师串</span>
        <Textarea
          v-model="editorDraft.text"
          class="w-full min-w-0"
          rows="3"
          auto-resize
          placeholder="画师串，例如：@wlop"
          aria-label="画师串内容"
        />
      </label>
    </div>
    <template #footer>
      <Button label="取消" severity="secondary" variant="outlined" @click="closeEntryEditor" />
      <Button label="保存" @click="saveEntryEditor" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';

import { createArtistTagEntry, type ArtistTagEntry } from '@/constants/artist-tag';
import CollapsiblePanelItem from '@/panel/components/CollapsiblePanelItem.vue';
import CvMiniButton from '@/panel/components/CvMiniButton.vue';
import CvMiniToggleSwitch from '@/panel/components/CvMiniToggleSwitch.vue';
import PromptEntryList from '@/panel/components/PromptEntryList.vue';
import { requestConfirmation, type ShowConfirm } from '@/panel/confirm-action';
import { parseArtistTagImportText } from '@/services/image-prompt/artist-tag-import';
import { useSettingsStore } from '@/store/settings';

interface ArtistTagEntryDraft {
  name: string;
  text: string;
}

const { settings } = useSettingsStore();
const pool = computed(() => settings.artistTagPool);
const fileInput = ref<HTMLInputElement | null>(null);
const showConfirm = inject<ShowConfirm>('showConfirm');
const isEntryListCollapsed = ref(true);
const editingEntryId = ref<string | null>(null);
const editorDraft = ref<ArtistTagEntryDraft | null>(null);

const entryCountLabel = computed(() => {
  const enabledCount = pool.value.entries.filter(entry => entry.enabled).length;
  return `共 ${pool.value.entries.length} 条 / 启用 ${enabledCount}`;
});

const isEditorVisible = computed({
  get: () => editorDraft.value !== null,
  set: (visible: boolean) => {
    if (!visible) closeEntryEditor();
  },
});

/**
 * 追加一条空白画师串并打开编辑弹窗
 */
function addEntry(): void {
  const entry = createArtistTagEntry(uuidv4());
  pool.value.entries.push(entry);
  isEntryListCollapsed.value = false;
  openEntryEditor(entry);
}

/**
 * 删除指定画师串
 * @param id 条目 id
 */
function removeEntry(id: string): void {
  const index = pool.value.entries.findIndex(entry => entry.id === id);
  if (index !== -1) pool.value.entries.splice(index, 1);
  if (editingEntryId.value === id) closeEntryEditor();
}

/**
 * 打开条目编辑弹窗
 * @param entry 画师串条目
 */
function openEntryEditor(entry: ArtistTagEntry): void {
  editingEntryId.value = entry.id;
  editorDraft.value = { name: entry.name, text: entry.text };
}

/**
 * 关闭条目编辑弹窗
 */
function closeEntryEditor(): void {
  editingEntryId.value = null;
  editorDraft.value = null;
}

/**
 * 保存条目编辑弹窗
 */
function saveEntryEditor(): void {
  const entry = pool.value.entries.find(item => item.id === editingEntryId.value);
  if (entry && editorDraft.value) {
    entry.name = editorDraft.value.name;
    entry.text = editorDraft.value.text;
  }
  closeEntryEditor();
}

/**
 * 获取条目标题
 * @param entry 画师串条目
 * @returns 标题
 */
function getEntryTitle(entry: ArtistTagEntry): string {
  return entry.name.trim() || entry.text.trim() || '未命名画师串';
}

/**
 * 获取条目内容预览
 * @param entry 画师串条目
 * @returns 内容预览
 */
function getEntryText(entry: ArtistTagEntry): string {
  return entry.text.trim() || '未填写画师串';
}

/**
 * 打开画师串 JSON 文件选择器
 */
function openImportFilePicker(): void {
  fileInput.value?.click();
}

/**
 * 导入用户选择的画师串 JSON 文件
 * @param event 文件输入事件
 */
async function handleImportFileChange(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  try {
    const preview = parseArtistTagImportText(await file.text(), pool.value.entries);
    const confirmed = await requestConfirmation(showConfirm, {
      title: '导入画师串',
      message: `确定要从“${preview.packageName}”追加 ${preview.entries.length} 条画师串吗？重复 ${preview.duplicateCount} 条，无效 ${preview.invalidCount} 条。`,
      acceptLabel: '导入',
      cancelLabel: '取消',
    });
    if (!confirmed) return;

    for (const entry of preview.entries) {
      const artistTag = createArtistTagEntry(uuidv4(), entry.name, entry.text);
      artistTag.enabled = entry.enabled;
      pool.value.entries.push(artistTag);
    }

    isEntryListCollapsed.value = false;
    toastr.success(`画师串导入完成：新增 ${preview.entries.length} 条`);
    preview.warnings.slice(0, 3).forEach(warning => toastr.warning(warning));
  } catch (error) {
    toastr.error(error instanceof Error ? error.message : '画师串导入失败');
    console.error('[CosmosVision] 画师串导入失败', error);
  } finally {
    if (fileInput.value) fileInput.value.value = '';
  }
}
</script>
