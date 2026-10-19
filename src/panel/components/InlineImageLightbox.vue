<template>
  <Teleport to="body">
    <Transition name="cv-lightbox">
      <div
        v-if="inlineLightboxState.open"
        class="cv-lightbox-overlay cosmos-vision-root"
        :class="{ [DARK_CLASS]: darkMode }"
        @click="handleOverlayClick"
      >
        <!-- 图片区：PrimeVue Gallery 提供捏合缩放 / 拖拽平移 / 点击切换缩放 -->
        <div
          class="cv-lightbox-img-box"
          @click.capture="handleImgBoxClickCapture"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
          @touchcancel="handleTouchEnd"
        >
          <Gallery @zoom-change="handleZoomChange">
            <GalleryContent class="cv-lightbox-gallery-content">
              <GalleryItem :key="inlineLightboxState.key" :zoomed-scale="3">
                <img v-if="currentSrc" :src="currentSrc" alt="放大图片" draggable="false" />
                <div v-else class="cv-lightbox-img-loading" role="status" aria-live="polite">图片加载中…</div>
              </GalleryItem>
            </GalleryContent>

            <!-- 翻页箭头：贴在图片左右两侧，手机端隐藏改用左右滑动 -->
            <template v-if="galleryTotal > 1">
              <button
                type="button"
                class="cv-lightbox-arrow cv-lightbox-arrow--prev"
                title="上一张（←）"
                aria-label="上一张"
                :disabled="!canNavigate"
                @click.stop="navigate(-1)"
              >
                <i class="fa-solid fa-chevron-left" />
              </button>
              <button
                type="button"
                class="cv-lightbox-arrow cv-lightbox-arrow--next"
                title="下一张（→）"
                aria-label="下一张"
                :disabled="!canNavigate"
                @click.stop="navigate(1)"
              >
                <i class="fa-solid fa-chevron-right" />
              </button>
            </template>

            <!-- 左上角：序号与批量勾选/执行 -->
            <div v-if="galleryTotal > 0" class="cv-lightbox-nav" @click.stop>
              <span class="cv-lightbox-nav-counter">{{ Math.max(currentIndex, 0) + 1 }} / {{ galleryTotal }}</span>
              <template v-if="inlineLightboxState.batch">
                <label
                  class="cv-lightbox-select"
                  :class="{ 'is-disabled': inlineLightboxState.batch.disabled }"
                  title="勾选/取消勾选当前图片"
                >
                  <input
                    type="checkbox"
                    :checked="isCurrentSelected"
                    :disabled="inlineLightboxState.batch.disabled"
                    @change="toggleCurrentSelection"
                  />
                  <span>选择</span>
                </label>
                <button
                  type="button"
                  class="cv-lightbox-batch-exec"
                  :class="{ 'is-danger': inlineLightboxState.batch.action === 'delete' }"
                  :disabled="inlineLightboxState.batch.disabled || !inlineLightboxState.batch.count"
                  @click="executeBatch"
                >
                  <i
                    class="fa-solid"
                    :class="inlineLightboxState.batch.action === 'delete' ? 'fa-trash' : 'fa-download'"
                  />
                  <span>
                    {{ inlineLightboxState.batch.action === 'delete' ? '删除选中' : '下载选中' }}（{{
                      inlineLightboxState.batch.count
                    }}）
                  </span>
                </button>
              </template>
            </div>

            <!-- 工具栏须在 Gallery 子树内，Zoom 按钮才能 inject $pcGallery -->
            <div class="cv-lightbox-toolbar" @click.stop>
              <GalleryZoomIn title="放大" aria-label="放大" :pt="galleryActionPt">
                <i class="fa-solid fa-magnifying-glass-plus" />
              </GalleryZoomIn>
              <GalleryZoomOut title="缩小" aria-label="缩小" :pt="galleryActionPt">
                <i class="fa-solid fa-magnifying-glass-minus" />
              </GalleryZoomOut>
              <button
                type="button"
                class="cv-lightbox-info-toggle"
                :class="{ active: infoPanelVisible }"
                title="图片信息"
                aria-label="图片信息"
                @click="infoPanelVisible = !infoPanelVisible"
              >
                <i class="fa-solid fa-circle-info" />
              </button>
              <button
                v-if="hasCurrentDownload"
                type="button"
                class="cv-lightbox-download"
                title="下载图片"
                aria-label="下载图片"
                @click="handleDownload"
              >
                <i class="fa-solid fa-download" />
              </button>
              <button
                type="button"
                class="cv-lightbox-close"
                title="关闭"
                aria-label="关闭"
                @click="closeInlineImageLightbox"
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>
          </Gallery>
        </div>

        <!-- 图片生图元数据面板 -->
        <LightboxImageInfoPanel v-if="infoPanelVisible" :snapshot="currentSnapshot" @click.stop />

        <!-- 底部提示词详情面板 -->
        <div class="cv-lightbox-info" :class="{ 'cv-info-collapsed': infoCollapsed }" @click.stop>
          <div class="cv-lightbox-info-header">
            <span class="cv-lightbox-info-title">提示词详情</span>
            <button
              type="button"
              class="cv-lightbox-toggle-btn"
              title="隐藏/显示提示词"
              @click="infoCollapsed = !infoCollapsed"
            >
              <i class="fa-solid" :class="infoCollapsed ? 'fa-eye' : 'fa-eye-slash'" />
              <span>{{ infoCollapsed ? '显示' : '隐藏' }}提示词</span>
            </button>
          </div>
          <div class="cv-lightbox-info-body">
            <div class="cv-lightbox-prompt-group">
              <div class="cv-lightbox-prompt-header">
                <span class="cv-lightbox-prompt-title cv-lightbox-title-pos">正面提示词</span>
                <button type="button" class="cv-lightbox-copy-btn" @click="copyPrompt(COPY_KEY_POS, positivePrompt)">
                  <template v-if="copiedKey === COPY_KEY_POS"><i class="fa-solid fa-check" /> 已复制</template>
                  <template v-else><i class="fa-solid fa-copy" /> 复制</template>
                </button>
              </div>
              <div class="cv-lightbox-prompt-content">{{ positivePrompt }}</div>
            </div>
            <div class="cv-lightbox-prompt-group">
              <div class="cv-lightbox-prompt-header">
                <span class="cv-lightbox-prompt-title cv-lightbox-title-neg">负面提示词</span>
                <button type="button" class="cv-lightbox-copy-btn" @click="copyPrompt(COPY_KEY_NEG, negativePrompt)">
                  <template v-if="copiedKey === COPY_KEY_NEG"><i class="fa-solid fa-check" /> 已复制</template>
                  <template v-else><i class="fa-solid fa-copy" /> 复制</template>
                </button>
              </div>
              <div class="cv-lightbox-prompt-content">{{ negativePrompt }}</div>
            </div>
            <div v-if="characters.length" class="cv-lightbox-prompt-group cv-lightbox-character-section">
              <div class="cv-lightbox-prompt-header">
                <span class="cv-lightbox-prompt-title cv-lightbox-title-char"
                  >角色提示词（{{ characters.length }}）</span
                >
              </div>
              <div class="cv-lightbox-character-list">
                <div
                  v-for="(item, index) in characters"
                  :key="index"
                  class="cv-lightbox-character-item"
                  :class="{ 'cv-char-collapsed': collapsedCharIndexes.has(index) }"
                >
                  <button
                    type="button"
                    class="cv-lightbox-character-toggle"
                    :aria-expanded="!collapsedCharIndexes.has(index)"
                    @click="toggleCharacterItem(index)"
                  >
                    <i
                      class="fa-solid cv-lightbox-character-chevron"
                      :class="collapsedCharIndexes.has(index) ? 'fa-chevron-right' : 'fa-chevron-down'"
                    />
                    <span class="cv-lightbox-character-title">{{ getCharacterItemTitle(item, index) }}</span>
                  </button>
                  <div class="cv-lightbox-character-body">
                    <div class="cv-lightbox-character-field">
                      <div class="cv-lightbox-character-label-row">
                        <span class="cv-lightbox-character-label">角色正面</span>
                        <button
                          type="button"
                          class="cv-lightbox-copy-btn"
                          @click="copyPrompt(getCharCopyKey(index, true), item.positivePrompt || '')"
                        >
                          <template v-if="copiedKey === getCharCopyKey(index, true)">
                            <i class="fa-solid fa-check" /> 已复制
                          </template>
                          <template v-else><i class="fa-solid fa-copy" /> 复制</template>
                        </button>
                      </div>
                      <div class="cv-lightbox-prompt-content">{{ item.positivePrompt || '(空)' }}</div>
                    </div>
                    <div class="cv-lightbox-character-field">
                      <div class="cv-lightbox-character-label-row">
                        <span class="cv-lightbox-character-label">角色负面</span>
                        <button
                          type="button"
                          class="cv-lightbox-copy-btn"
                          @click="copyPrompt(getCharCopyKey(index, false), item.negativePrompt || '')"
                        >
                          <template v-if="copiedKey === getCharCopyKey(index, false)">
                            <i class="fa-solid fa-check" /> 已复制
                          </template>
                          <template v-else><i class="fa-solid fa-copy" /> 复制</template>
                        </button>
                      </div>
                      <div class="cv-lightbox-prompt-content">{{ item.negativePrompt || '(空)' }}</div>
                    </div>
                    <div class="cv-lightbox-character-field">
                      <span class="cv-lightbox-character-label">坐标</span>
                      <div class="cv-lightbox-prompt-content">{{ formatCharacterPosition(item) }}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import Gallery from 'primevue/gallery';
import GalleryContent from 'primevue/gallerycontent';
import GalleryItem from 'primevue/galleryitem';
import GalleryZoomIn from 'primevue/galleryzoomin';
import GalleryZoomOut from 'primevue/galleryzoomout';
import { computed, onUnmounted, ref, watch } from 'vue';
import type { CharacterPromptItem } from '@/constants/novelai';
import { closeInlineImageLightbox, inlineLightboxState } from '@/composables/inlineImageLightbox';
import { DARK_CLASS } from '@/constants/default-settings';
import { useSettingsStore } from '@/store/settings';
import LightboxImageInfoPanel from '@/panel/components/LightboxImageInfoPanel.vue';

/** 正面提示词复制按钮的 key */
const COPY_KEY_POS = 'pos';

/** 负面提示词复制按钮的 key */
const COPY_KEY_NEG = 'neg';

/** Gallery 放大/缩小按钮 PT：仅锚点；尺寸/颜色/hover 由 gallery token 控制，边框/底色见 inline-lightbox.css 共享视觉组 */
const galleryActionPt = { root: { class: 'cv-lightbox-gallery-action' } };

const settingsStore = useSettingsStore();
const darkMode = computed(() => settingsStore.darkMode);

/** 提示词详情面板是否折叠（默认折叠，与原命令式行为一致） */
const infoCollapsed = ref(true);

/** 是否显示图片生图元数据面板 */
const infoPanelVisible = ref(false);

/** 处于 1.5s 成功态的复制按钮 key */
const copiedKey = ref<string | null>(null);

/** 折叠的角色提示词序号集合（默认全部折叠） */
const collapsedCharIndexes = ref(new Set<number>());

/** 当前图片是否处于放大状态：放大后单指拖动用于平移，不触发滑动翻页 */
const isZoomed = ref(false);

/** 触摸滑动起点（仅在单指且未放大时记录） */
let touchStart: { x: number; y: number; time: number } | null = null;

/** 最近一次滑动结束时间：用于吞掉松手后浏览器补发的 click，避免误触缩放 */
let lastSwipeAt = 0;

/** 复制成功态还原定时器 */
let copiedTimer = 0;

/** 图片池 key 快照（调用方 keys() 返回数组，模板引用需缓存以免每帧重建） */
const galleryKeys = computed(() => (inlineLightboxState.open ? (inlineLightboxState.gallery?.keys() ?? []) : []));

/** 当前图片序号（-1 = 不在图片池中） */
const currentIndex = computed(() => galleryKeys.value.indexOf(inlineLightboxState.key));

/** 图片池总数；0 表示单图模式 */
const galleryTotal = computed(() => galleryKeys.value.length);

/** 左右翻页按钮可用性（加载中 / 批量处理中禁止切图，避免勾选与操作对象错位） */
const canNavigate = computed(() => galleryTotal.value > 1 && !inlineLightboxState.batch?.disabled);

/** 当前图片地址（图片池模式下随加载状态变化） */
const currentSrc = computed(() =>
  inlineLightboxState.gallery ? inlineLightboxState.gallery.srcOf(inlineLightboxState.key) : inlineLightboxState.src,
);

/** 当前图片的提示词快照 */
const currentSnapshot = computed(() =>
  inlineLightboxState.gallery
    ? inlineLightboxState.gallery.snapshotOf(inlineLightboxState.key)
    : inlineLightboxState.snapshot,
);

/** 当前图片是否已勾选 */
const isCurrentSelected = computed(() => {
  const batch = inlineLightboxState.batch;
  return galleryTotal.value > 0 && Boolean(batch?.isSelected(inlineLightboxState.key));
});

/** 当前图片是否提供单张下载（图片池按 key 查询，单图模式看全局回调） */
const hasCurrentDownload = computed(() =>
  inlineLightboxState.gallery
    ? Boolean(inlineLightboxState.gallery.downloadOf(inlineLightboxState.key))
    : Boolean(inlineLightboxState.onDownload),
);

/** 正面提示词文本（无快照时占位提示） */
const positivePrompt = computed(() => {
  const snapshot = currentSnapshot.value;
  const prompt = snapshot?.comfyui?.positivePrompt ?? snapshot?.positivePrompt;
  return prompt || '无正面提示词';
});

/** 负面提示词文本（无快照时占位提示） */
const negativePrompt = computed(() => {
  const snapshot = currentSnapshot.value;
  const prompt = snapshot?.comfyui?.negativePrompt ?? snapshot?.negativePrompt;
  return prompt || '无负面提示词';
});

/** 角色提示词列表 */
const characters = computed(() => currentSnapshot.value?.novelai?.characterPrompts ?? []);

// 切图或当前图片加载完成后同步快照，并预取相邻图片
watch(
  [() => inlineLightboxState.key, currentSrc],
  ([key]) => {
    const gallery = inlineLightboxState.gallery;
    if (!gallery || !key) return;
    inlineLightboxState.snapshot = gallery.snapshotOf(key);
    inlineLightboxState.onDownload = gallery.downloadOf(key);
    const index = galleryKeys.value.indexOf(key);
    gallery.ensure(key);
    for (const neighbor of [galleryKeys.value[index - 1], galleryKeys.value[index + 1]]) {
      if (neighbor) gallery.ensure(neighbor);
    }
  },
  { immediate: true },
);

// 打开时重置面板折叠/角色折叠并绑定键盘；关闭时解绑
watch(
  () => inlineLightboxState.open,
  open => {
    if (open) {
      infoCollapsed.value = true;
      infoPanelVisible.value = false;
      collapsedCharIndexes.value = new Set(characters.value.map((_, index) => index));
      isZoomed.value = false;
      touchStart = null;
      document.addEventListener('keydown', handleKeydown);
    } else {
      infoPanelVisible.value = false;
      document.removeEventListener('keydown', handleKeydown);
    }
  },
);

onUnmounted(() => document.removeEventListener('keydown', handleKeydown));

/**
 * ESC 关闭灯箱或元数据面板；左右方向键在图片池内翻页
 * @param e 键盘事件
 */
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!canNavigate.value) return;
    // 避免方向键同时滚动灯箱背后的页面
    e.preventDefault();
    navigate(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if (e.key !== 'Escape') return;
  if (infoPanelVisible.value) {
    infoPanelVisible.value = false;
    return;
  }
  closeInlineImageLightbox();
}

/**
 * 按偏移切换当前图片（首尾循环）
 * @param step -1 上一张 / 1 下一张
 */
function navigate(step: number): void {
  const gallery = inlineLightboxState.gallery;
  const total = galleryTotal.value;
  if (!gallery || total <= 1) return;
  const index = currentIndex.value < 0 ? 0 : currentIndex.value;
  const nextKey = galleryKeys.value[(index + step + total) % total];
  if (!nextKey) return;
  inlineLightboxState.key = nextKey;
  inlineLightboxState.src = gallery.srcOf(nextKey);
  inlineLightboxState.snapshot = gallery.snapshotOf(nextKey);
  inlineLightboxState.onDownload = gallery.downloadOf(nextKey);
  // 切换后 GalleryItem 重新挂载，缩放状态归位
  isZoomed.value = false;
}

/**
 * 记录 Gallery 缩放状态（放大后不触发滑动翻页）
 * @param scale 当前缩放倍数
 */
function handleZoomChange(scale: number): void {
  isZoomed.value = scale > 1;
}

/**
 * 记录滑动起点；多指手势留给 Gallery 做捏合缩放
 * @param event 触摸开始事件
 */
function handleTouchStart(event: TouchEvent): void {
  touchStart = null;
  if (isZoomed.value || !canNavigate.value || event.touches.length !== 1) return;
  const touch = event.touches[0];
  touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
}

/**
 * 横向滑动时阻止默认行为，避免松手后被当作图片点击而触发缩放
 * @param event 触摸移动事件
 */
function handleTouchMove(event: TouchEvent): void {
  if (!touchStart || event.touches.length !== 1) return;
  const touch = event.touches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) event.preventDefault();
}

/**
 * 单指水平滑动超过阈值时切换上一张 / 下一张
 * @param event 触摸结束事件
 */
function handleTouchEnd(event: TouchEvent): void {
  const start = touchStart;
  touchStart = null;
  if (!start || isZoomed.value || !canNavigate.value) return;
  const touch = event.changedTouches[0];
  if (!touch) return;
  const dx = touch.clientX - start.x;
  const dy = touch.clientY - start.y;
  const elapsed = Date.now() - start.time;
  if (elapsed > 1000) return;
  if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
  lastSwipeAt = Date.now();
  navigate(dx < 0 ? 1 : -1);
}

/**
 * 滑动松手后吞掉补发的 click，避免被 GalleryItem 当作点击缩放
 * @param event 点击事件
 */
function handleImgBoxClickCapture(event: MouseEvent): void {
  if (Date.now() - lastSwipeAt > 350) return;
  event.stopPropagation();
  event.preventDefault();
}

/**
 * 切换当前大图的勾选状态
 */
function toggleCurrentSelection(): void {
  const batch = inlineLightboxState.batch;
  if (!batch || batch.disabled) return;
  batch.toggle(inlineLightboxState.key);
}

/**
 * 执行批量下载或删除，并收起灯箱（操作后图片列表可能变化）
 */
function executeBatch(): void {
  const batch = inlineLightboxState.batch;
  if (!batch || batch.disabled || !batch.count) return;
  closeInlineImageLightbox();
  batch.execute();
}

/**
 * 背景点击关闭：点击 overlay / 图片区空白处生效，点击图片本身不关闭
 * @param e 点击事件
 */
function handleOverlayClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  // 图片点击是 Gallery 的切换缩放手势，不能关闭灯箱
  if (target.closest('.p-gallery-item')) return;
  closeInlineImageLightbox();
}

/**
 * 触发下载回调并捕获异步错误
 */
function handleDownload(): void {
  const download = inlineLightboxState.gallery
    ? inlineLightboxState.gallery.downloadOf(inlineLightboxState.key)
    : inlineLightboxState.onDownload;
  void Promise.resolve(download?.()).catch(error => {
    console.error('[CosmosVision] 下载图片失败', error);
  });
}

/**
 * 复制提示词文本并展示 1.5s 成功态
 * @param key 复制按钮标识
 * @param text 待复制文本
 */
async function copyPrompt(key: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      copiedKey.value = null;
    }, 1500);
  } catch {
    toastr.error('复制失败');
  }
}

/**
 * 生成角色提示词复制按钮的 key
 * @param index 角色序号
 * @param isPositive 是否为角色正面提示词
 * @returns key 文本
 */
function getCharCopyKey(index: number, isPositive: boolean): string {
  return `${isPositive ? 'char-pos' : 'char-neg'}-${index}`;
}

/**
 * 切换单个角色提示词折叠状态
 * @param index 角色序号
 */
function toggleCharacterItem(index: number): void {
  const next = new Set(collapsedCharIndexes.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  collapsedCharIndexes.value = next;
}

/**
 * 生成角色折叠标题（序号 + 正面提示词前 36 字预览）
 * @param item 角色提示词
 * @param index 角色序号
 * @returns 标题文本
 */
function getCharacterItemTitle(item: CharacterPromptItem, index: number): string {
  const preview = item.positivePrompt.trim() || '(空)';
  const short = preview.length > 36 ? `${preview.slice(0, 36)}…` : preview;
  return `角色 ${index + 1} · ${short}`;
}

/**
 * 格式化角色坐标展示文本
 * @param item 角色提示词
 * @returns 坐标文本
 */
function formatCharacterPosition(item: CharacterPromptItem): string {
  const useCharacterCoords = currentSnapshot.value?.novelai?.useCharacterCoords;
  if (characters.value.length < 2 || useCharacterCoords === false) return 'Auto';
  return `x: ${item.position.x.toFixed(2)}, y: ${item.position.y.toFixed(2)}`;
}
</script>
