<script setup lang="ts">
import {
  clearAllGalleryDom,
  listGalleryDomContainers,
  notifyGallerySlotChanged,
  provideGalleryStoreApi,
  renderGalleryDom,
  unmountGalleryDom,
} from '@/composables/inlineGalleryDomRenderer';
import { registerGalleryRendererCallbacks, useGalleryRuntimesStore } from '@/store/gallery-runtimes';
import { storeToRefs } from 'pinia';
import { watch } from 'vue';

/**
 * 画廊挂载协调者（命令式 DOM 版）
 *
 * 旧实现 <Teleport defer :to="mount.element"> 及后续 cv-gallery 自定义
 * 元素方案均无法根治 Vue 组件树嵌入 ST 聊天 DOM 引发的 subTree/nextSibling
 * 卸载崩溃。本组件现在只做一件事：监听 runtimes，把每个 mount 的容器交给
 * 命令式渲染器（纯原生 DOM，与灯箱同模式）。
 *
 * 数据更新不经本组件：生图/收藏/删除路径经 registerGalleryRendererCallbacks
 * 注册的回调直通渲染器，渲染器自取数据全量重画。ST 删容器 → DOM 自然
 * 消亡，无任何组件树残留。回调注册在本组件完成，断开 store↔渲染器环。
 */
const galleryStore = useGalleryRuntimesStore();
const { runtimes } = storeToRefs(galleryStore);
provideGalleryStoreApi({ removeMount: (key, messageId) => galleryStore.removeMount(key, messageId) });
registerGalleryRendererCallbacks(notifyGallerySlotChanged, clearAllGalleryDom);

/** 一次同步：新增容器渲染、消失容器卸载 */
function sync(): void {
  const seen = new Set<HTMLElement>();
  for (const runtime of runtimes.value) {
    for (const mount of runtime.mounts) {
      if (!mount.element.isConnected) continue;
      if (seen.has(mount.element)) continue;
      seen.add(mount.element);
      void renderGalleryDom(mount);
    }
  }
  // 已接管但脱离文档的容器：卸载（ST 删 DOM 场景由注册表对账兜底）
  for (const container of listGalleryDomContainers()) {
    if (!container.isConnected) unmountGalleryDom(container);
  }
  // store 已剔除的容器：卸载其画廊 DOM
  document.querySelectorAll('#chat .cv-render').forEach(container => {
    const el = container as HTMLElement;
    if (seen.has(el)) return;
    if (el.querySelector('.cv-inline-img-wrap')) unmountGalleryDom(el);
  });
}

watch(runtimes, sync, { deep: true, immediate: true });

onUnmounted(() => {
  clearAllGalleryDom();
});
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
