<template>
  <CollapsiblePanelItem title="服装连续性" :collapsed="collapsed" @toggle="collapsed = !collapsed">
    <template #actions>
      <CvMiniToggleSwitch
        :model-value="config.enabled"
        aria-label="注入服装维护提示词"
        :disabled="!chatAvailable"
        @update:model-value="setEnabled"
      />
    </template>
    <section class="flex flex-col gap-(--cv-space-xl)">
      <div class="cv-field-hint">
        本聊天独立设置，修改即时保存。开启后正文模型同步维护主角和出场配角的穿着；记录隐藏，生图按对应剧情读取。关闭后停止注入维护要求，已有记录仍可用于历史生图。
      </div>
      <div v-if="!chatAvailable" class="cv-field-hint">请先打开一个聊天。</div>
      <label class="cv-field">
        <span>维护提示词</span>
        <CvExpandableTextarea
          :model-value="config.prompt"
          rows="6"
          class="w-full"
          :disabled="!chatAvailable"
          @update:model-value="setPrompt"
        />
      </label>
      <CvMiniButton
        label="恢复默认提示词"
        icon="fa-solid fa-arrows-rotate"
        :disabled="!chatAvailable"
        @click="setPrompt(DEFAULT_OUTFIT_CONTINUITY_PROMPT)"
      />
      <div class="flex flex-col gap-(--cv-space-md)">
        <span>当前服装记录</span>
        <div
          v-for="record in records"
          :key="record.name"
          class="rounded-(--cv-radius-sm) bg-(--cv-surface-container-low) p-(--cv-space-lg)"
        >
          <div class="flex items-center justify-between gap-(--cv-space-md)">
            <strong>{{ record.name }}</strong>
            <CvMiniButton label="纠正" icon="fa-regular fa-pen" @click="editRecord(record)" />
          </div>
          <p class="whitespace-pre-wrap">{{ record.outfit || '未穿戴衣物或配饰' }}</p>
          <div class="cv-field-hint">来源：楼层 {{ record.messageIndex }} · 第 {{ record.fromParagraph }} 段</div>
        </div>
        <div v-if="!records.length" class="cv-field-hint">暂无记录。开启后从下一条正文回复开始建立，也可手动填写。</div>
      </div>
      <label class="cv-field"
        ><span>人物姓名</span><InputText v-model="draftName" :disabled="!chatAvailable" fluid
      /></label>
      <label class="cv-field"
        ><span>完整穿着</span
        ><CvExpandableTextarea
          v-model="draftOutfit"
          rows="3"
          class="w-full"
          :disabled="!chatAvailable"
          placeholder="衣服、鞋袜、配饰及穿戴状态；无穿戴时请明确填写"
      /></label>
      <div class="grid grid-cols-2 gap-(--cv-space-lg)">
        <label class="cv-field"
          ><span>生效楼层（从 0 起）</span
          ><InputNumber
            v-model="draftMessage"
            :min="0"
            :max="Math.max(0, chatLength - 1)"
            :use-grouping="false"
            :disabled="!chatAvailable"
            fluid
        /></label>
        <label class="cv-field"
          ><span>起始段落（从 1 起）</span
          ><InputNumber v-model="draftParagraph" :min="1" :use-grouping="false" :disabled="!chatAvailable" fluid
        /></label>
      </div>
      <label class="cv-field"
        ><span>生效处正文原句（可选）</span
        ><InputText
          v-model="draftAnchor"
          :disabled="!chatAvailable"
          placeholder="HTML 气泡或换装时，填写对应段落的原句可帮助准确定位"
          fluid
      /></label>
      <div class="cv-field-hint">
        保存到指定 AI 消息的当前回复分支，从指定段落开始生效。同一回复之后的换装记录仍按原位置生效。
      </div>
      <Button
        label="保存服装记录"
        icon="fa-solid fa-check"
        :disabled="!chatAvailable || !draftName.trim() || !draftOutfit.trim()"
        @click="saveRecord"
      />
      <div v-if="feedback" class="cv-field-hint" role="status">{{ feedback }}</div>
    </section>
  </CollapsiblePanelItem>
</template>

<script setup lang="ts">
import { chat, getCurrentChatId } from '@sillytavern/script';
import { DEFAULT_OUTFIT_CONTINUITY_PROMPT, type OutfitRecord } from '@/constants/outfit-continuity';
import {
  OUTFIT_CONTINUITY_CHANGED,
  readCurrentOutfitRecords,
  readOutfitContinuitySettings,
  saveManualOutfitUpdate,
  saveOutfitContinuitySettings,
} from '@/services/outfit-continuity/runtime';
import CollapsiblePanelItem from './CollapsiblePanelItem.vue';
import CvMiniToggleSwitch from './CvMiniToggleSwitch.vue';
import CvMiniButton from './CvMiniButton.vue';
import CvExpandableTextarea from './CvExpandableTextarea.vue';

const collapsed = ref(true);
const config = ref(readOutfitContinuitySettings());
const records = ref(readCurrentOutfitRecords());
const chatAvailable = ref(Boolean(getCurrentChatId()));
const chatLength = ref(chat.length);
const draftName = ref('');
const draftOutfit = ref('');
const draftMessage = ref(lastAssistantIndex());
const draftParagraph = ref(1);
const draftAnchor = ref('');
const feedback = ref('');
let currentChatId = getCurrentChatId();

function lastAssistantIndex(): number {
  return Math.max(
    0,
    chat.findLastIndex(message => !message.is_user && !message.is_system),
  );
}

function reload(): void {
  if (currentChatId !== getCurrentChatId()) {
    currentChatId = getCurrentChatId();
    draftName.value = '';
    draftOutfit.value = '';
    draftAnchor.value = '';
    draftMessage.value = lastAssistantIndex();
    draftParagraph.value = 1;
    feedback.value = '';
  }
  config.value = readOutfitContinuitySettings();
  records.value = readCurrentOutfitRecords();
  chatAvailable.value = Boolean(currentChatId);
  chatLength.value = chat.length;
}

function setEnabled(enabled: boolean): void {
  saveOutfitContinuitySettings({ ...config.value, enabled });
  reload();
}

function setPrompt(prompt: string | undefined): void {
  saveOutfitContinuitySettings({ ...config.value, prompt: prompt ?? '' });
  reload();
}

function editRecord(record: OutfitRecord): void {
  draftName.value = record.name;
  draftOutfit.value = record.outfit;
  draftMessage.value = record.messageIndex;
  draftParagraph.value = record.fromParagraph;
  draftAnchor.value = record.fromText ?? '';
  feedback.value = '';
}

function saveRecord(): void {
  try {
    saveManualOutfitUpdate(draftMessage.value, {
      name: draftName.value,
      outfit: draftOutfit.value,
      fromParagraph: draftParagraph.value,
      ...(draftAnchor.value.trim() ? { fromText: draftAnchor.value.trim() } : {}),
    });
    feedback.value = '服装记录已保存';
    reload();
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : '保存失败';
  }
}

onMounted(() => window.addEventListener(OUTFIT_CONTINUITY_CHANGED, reload));
onBeforeUnmount(() => window.removeEventListener(OUTFIT_CONTINUITY_CHANGED, reload));
</script>
