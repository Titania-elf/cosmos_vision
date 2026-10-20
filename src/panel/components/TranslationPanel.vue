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
    <div aria-live="polite" :aria-busy="pending">
      <div
        v-if="error"
        role="alert"
        class="text-(length:--cv-font-size-xs) leading-[1.5] break-words text-(--cvp-red-500)"
      >
        翻译失败：{{ error }}
      </div>
      <template v-else-if="text">
        <div class="mb-(--cv-space-xs) text-(length:--cv-font-size-xs) font-semibold text-(--cv-on-surface-variant)">
          译文 · {{ targetLabel }}
        </div>
        <div
          class="custom-scrollbar max-h-[min(22dvh,11rem)] overflow-y-auto overscroll-contain text-(length:--cv-font-size-sm) leading-[1.5] break-words whitespace-pre-wrap text-(--cv-on-surface)"
        >
          {{ text }}
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import { useManualTranslation } from '@/composables/useManualTranslation';
import type { TranslationProvider } from '@/services/translation/text-translation';

const props = defineProps<{ source: string; visible: boolean }>();
const provider = defineModel<TranslationProvider>('provider', { required: true });
const providerOptions = [
  { label: 'Google', value: 'google' },
  { label: 'DeepL', value: 'deepl' },
];
const { text, targetLabel, pending, error, canTranslate, translate } = useManualTranslation(toRef(props, 'source'), {
  visible: toRef(props, 'visible'),
  provider,
});
</script>
