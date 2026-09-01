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
  openInlineImageLightbox,
  type InlineLightboxGalleryEntry,
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
    /** 灯箱画廊条目（传入多条时大图可左右切换） */
    gallery?: InlineLightboxGalleryEntry[];
    /** 当前图片在画廊中的序号 */
    galleryIndex?: number;
    /** 灯箱关闭回调（画廊持有方回收按需创建的 object URL） */
    onGalleryClose?: () => void;
  }>(),
  {
    alt: '',
    snapshot: undefined,
    downloadAction: undefined,
    downloadBlob: null,
    disabled: false,
    gallery: undefined,
    galleryIndex: 0,
    onGalleryClose: undefined,
  },
);

const requestDownloadOptions = inject<() => Promise<InlineImageDownloadOptions | null>>(
  IMAGE_DOWNLOAD_OPTIONS_REQUEST_KEY,
);

/**
 * 打开统一图片放大预览
 * 传入画廊时启用左右切换，下载动作取自各条目自身
 * @param event 鼠标或键盘事件
 */
function openPreview(event: MouseEvent | KeyboardEvent): void {
  if (props.disabled) return;
  event.stopPropagation();
  if (props.gallery?.length) {
    openInlineImageLightbox(props.src, props.snapshot, {
      gallery: { entries: props.gallery, index: props.galleryIndex },
      onClose: props.onGalleryClose,
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
