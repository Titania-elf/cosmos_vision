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
          开启后每次生图从下方已启用的条目中随机抽取 1 条，拼接在正向提示词最前面；NovelAI 与 ComfyUI 通用。池为空或条目全部禁用时不注入。
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
      <Fluid v-if="pool.entries.length" class="flex flex-col gap-(--cv-space-xl)">
        <div
          v-for="entry in pool.entries"
          :key="entry.id"
          class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-(--cv-space-md) border-b border-(--cv-surface-variant) pb-(--cv-space-lg) last:border-b-0 last:pb-0"
        >
          <ToggleSwitch
            v-model="entry.enabled"
            class="self-center"
            :aria-label="`${entry.name || '未命名画师串'} 启用状态`"
          />
          <InputText v-model="entry.name" placeholder="名称（仅用于识别）" class="w-full min-w-0" aria-label="画师串名称" />
          <Button
            icon="fa-solid fa-trash"
            severity="danger"
            variant="outlined"
            rounded
            class="self-center"
            aria-label="删除画师串"
            @click="removeEntry(entry.id)"
          />
          <Textarea
            v-model="entry.text"
            class="col-span-3 w-full min-w-0"
            rows="2"
            auto-resize
            placeholder="画师串，例如：artist:wlop, artist:ciloranko"
            aria-label="画师串内容"
          />
        </div>
      </Fluid>
      <div
        v-else
        class="rounded-(--cv-radius) border-(length:--cv-border-width) border-dashed border-(--cv-surface-variant) p-(--cv-space-xl) text-center text-(--cv-on-surface-variant)"
      >
        暂无画师串
      </div>

      <CvAddEntryButton label="新增画师串" class="mb-0" @click="addEntry" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';

import { createArtistTagEntry } from '@/constants/artist-tag';
import CvAddEntryButton from '@/panel/components/CvAddEntryButton.vue';
import { requestConfirmation, type ShowConfirm } from '@/panel/confirm-action';
import { parseArtistTagImportText } from '@/services/image-prompt/artist-tag-import';
import { useSettingsStore } from '@/store/settings';

const { settings } = useSettingsStore();
const pool = computed(() => settings.artistTagPool);
const fileInput = ref<HTMLInputElement | null>(null);
const showConfirm = inject<ShowConfirm>('showConfirm');

/**
 * 追加一条空白画师串
 */
function addEntry(): void {
  pool.value.entries.push(createArtistTagEntry(uuidv4()));
}

/**
 * 删除指定画师串
 * @param id 条目 id
 */
function removeEntry(id: string): void {
  const index = pool.value.entries.findIndex(entry => entry.id === id);
  if (index !== -1) pool.value.entries.splice(index, 1);
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
