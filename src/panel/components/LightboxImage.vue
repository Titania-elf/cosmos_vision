<template>
  <img
    :src="src"
    :alt="alt"
    :draggable="false"
    :role="disabled ? undefined : 'button'"
    :tabindex="disabled ? undefined : 0"
    :aria-disabled="disabled || undefined"
    class="cv-lightbox-image"
    @click="openPreview"
    @keydown.enter.prevent="openPreview"
    @keydown.space.prevent="openPreview"
  />
</template>

<script setup lang="ts">
import { inject } from 'vue';
import {
  openInlineImageGalleryLightbox,
  openInlineImageLightbox,
  type InlineLightboxBatch,
  type InlineLightboxGallery,
  type InlinePromptSnapshot,
} from '@/composables/inlineImageLightbox';
import {
  IMAGE_DOWNLOAD_OPTIONS_REQUEST_KEY,
  type InlineImageDownloadOptions,
} from '@/services/inline-image/download-options';
import { formatTimestampForFileName } from '@/services/inline-image/filename-utils';
import { downloadInlineImageBlob } from '@/services/inline-image/image-download-transform';

const props = withDefaults(
  defineProps<{
    src: string;
    alt?: string;
    snapshot?: InlinePromptSnapshot;
    downloadAction?: () => void | Promise<void>;
    downloadBlob?: Blob | null;
    disabled?: boolean;
    /** 图片池：传入后大图可左右翻页，而非只显示当前一张 */
    gallery?: InlineLightboxGallery | null;
    /** 当前图片在图片池中的 key */
    galleryKey?: string;
    /** 批量勾选上下文：大图内可勾选并执行批量下载或删除 */
    batch?: InlineLightboxBatch | null;
  }>(),
  {
    alt: '',
    snapshot: undefined,
    downloadAction: undefined,
    downloadBlob: null,
    disabled: false,
    gallery: null,
    galleryKey: '',
    batch: null,
  },
);

const requestDownloadOptions = inject<() => Promise<InlineImageDownloadOptions | null>>(
  IMAGE_DOWNLOAD_OPTIONS_REQUEST_KEY,
);

/**
 * 打开统一图片放大预览
 * @param event 鼠标或键盘事件
 */
function openPreview(event: MouseEvent | KeyboardEvent): void {
  if (props.disabled) return;
  event.stopPropagation();
  if (props.gallery && props.galleryKey) {
    openInlineImageGalleryLightbox(props.gallery, props.galleryKey, {
      batch: props.batch ?? undefined,
    });
    return;
  }
  const onDownload = resolveDownloadAction();
  openInlineImageLightbox(props.src, props.snapshot, onDownload ? { onDownload } : undefined);
}

/**
 * 解析当前图片的下载动作
 * @returns 可用的下载动作
 */
function resolveDownloadAction(): (() => void | Promise<void>) | undefined {
  if (props.downloadAction) return props.downloadAction;
  if (props.downloadBlob && requestDownloadOptions) return downloadCurrentBlob;
  return undefined;
}

/**
 * 使用统一下载配置保存当前图片
 */
async function downloadCurrentBlob(): Promise<void> {
  if (!props.downloadBlob || !requestDownloadOptions) return;
  const options = await requestDownloadOptions();
  if (!options) return;
  const timestamp = formatTimestampForFileName(Date.now());
  await downloadInlineImageBlob(props.downloadBlob, `cosmos-vision-image-${timestamp}`, options);
}
</script>

<style scoped>
.cv-lightbox-image:not([aria-disabled='true']) {
  cursor: zoom-in;
}

.cv-lightbox-image:focus-visible {
  outline: var(--cvp-focus-ring-width, 0.1333em) var(--cvp-focus-ring-style, solid)
    var(--cvp-focus-ring-color, color-mix(in srgb, var(--cv-primary-container) 28%, transparent));
  outline-offset: var(--cvp-focus-ring-offset, 0.1333em);
}
</style>
