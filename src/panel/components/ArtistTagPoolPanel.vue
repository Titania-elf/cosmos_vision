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
import { useSettingsStore } from '@/store/settings';

const { settings } = useSettingsStore();
const pool = computed(() => settings.artistTagPool);

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
</script>
