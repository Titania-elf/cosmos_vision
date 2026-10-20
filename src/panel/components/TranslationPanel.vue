<template>
  <div
    class="flex min-h-0 flex-col gap-(--cv-space-sm) rounded-(--cv-radius-md) border border-(--cv-surface-variant) bg-(--cv-surface-container-low) px-(--cv-space-lg) py-(--cv-space-md)"
  >
    <div class="flex flex-wrap items-center justify-between gap-(--cv-space-md)">
      <Select
        v-model="provider"
        :options="providerOptions"
        option-label="label"
        option-value="value"
        size="small"
        aria-label="翻译服务"
        class="w-32"
      />
      <Button
        :label="pending ? '翻译中…' : targetLabel ? `翻译为${targetLabel}` : '翻译'"
        icon="fa-solid fa-language"
        size="small"
        text
        :loading="pending"
        :disabled="!canTranslate"
        @click="translate"
      />
    </div>
    <div v-if="provider === 'deepl'" class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
      使用酒馆「扩展 → 聊天翻译」中配置的 DeepL 密钥和 Free / Pro 设置。
    </div>
    <div aria-live="polite" :aria-busy="pending || applying">
      <div
        v-if="error"
        role="alert"
        class="text-(length:--cv-font-size-xs) leading-[1.5] break-words text-(--cvp-red-500)"
      >
        翻译失败：{{ error }}
      </div>
      <template v-if="hasTranslation">
        <div class="mb-(--cv-space-xs) text-(length:--cv-font-size-xs) font-semibold text-(--cv-on-surface-variant)">
          译文 · {{ translationTargetLabel }}（可编辑）
        </div>
        <CvExpandableTextarea
          v-model="text"
          :rows="3"
          aria-label="可编辑译文"
          placeholder="修改译文后，可翻译为英文并写入上方提示词"
          class="custom-scrollbar max-h-[min(22dvh,11rem)] min-h-[5.5rem] w-full resize-none overflow-y-auto overscroll-contain"
        />
        <div class="mt-(--cv-space-sm) flex flex-wrap items-center justify-end gap-(--cv-space-sm)">
          <span v-if="applied" class="text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
            已写入上方提示词
          </span>
          <Button
            :label="applying ? '正在翻译为英文…' : '翻译为英文并写入上方'"
            aria-label="翻译为英文并写入上方"
            icon="fa-solid fa-arrow-up"
            size="small"
            :loading="applying"
            :disabled="!canApply"
            @click="translateAndApply"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { useManualTranslation } from '@/composables/useManualTranslation';
import CvExpandableTextarea from '@/panel/components/CvExpandableTextarea.vue';
import type { TranslationProvider } from '@/services/translation/text-translation';

const props = defineProps<{ source: string; visible: boolean }>();
const emit = defineEmits<{ apply: [translatedText: string] }>();
const provider = defineModel<TranslationProvider>('provider', { required: true });
const providerOptions = [
  { label: 'Google', value: 'google' },
  { label: 'DeepL', value: 'deepl' },
];
const {
  text,
  hasTranslation,
  targetLabel,
  translationTargetLabel,
  pending,
  applying,
  applied,
  error,
  canTranslate,
  canApply,
  translate,
  translateAndApply,
} = useManualTranslation(toRef(props, 'source'), {
  visible: toRef(props, 'visible'),
  provider,
  onApply: translatedText => emit('apply', translatedText),
});
</script>
