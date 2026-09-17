<template>
  <Dialog
    v-model:visible="visible"
    modal
    dismissable-mask
    :draggable="false"
    header="从 LoRA 管理器导入配方"
    :style="DIALOG_STYLE"
    :content-style="{ overflow: 'hidden' }"
  >
    <div class="flex flex-col gap-(--cv-space-3xl)">
      <!-- 搜索 + 排序 + 刷新 -->
      <div class="flex items-center gap-(--cv-space-md)">
        <InputText
          v-model="searchInput"
          placeholder="搜索配方标题 / LoRA / 标签..."
          class="min-w-0 flex-1"
          aria-label="搜索配方"
        />
        <Select
          v-model="sortBy"
          :options="sortOptions"
          option-label="label"
          option-value="value"
          class="w-[8rem] shrink-0"
          aria-label="配方排序"
        />
        <CvMiniButton
          icon="fa-solid fa-rotate"
          :class="{ 'animate-spin': isInitialLoading }"
          title="刷新配方列表"
          aria-label="刷新配方列表"
          @click="reload()"
        />
      </div>

      <!-- 配方列表 -->
      <div
        class="custom-scrollbar flex max-h-[min(52vh,26rem)] min-h-[12rem] flex-col gap-(--cv-space-xs) overflow-y-auto overscroll-contain"
      >
        <button
          v-for="recipe in recipes"
          :key="recipe.id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-(--cv-space-lg) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid px-(--cv-space-md) py-(--cv-space-sm) text-left transition-colors duration-150"
          :class="
            recipe.id === selectedId
              ? 'border-(--cvp-primary-color) bg-(--cv-surface-container-low)'
              : 'border-transparent bg-transparent hover:bg-(--cv-surface-container-highest)'
          "
          :aria-pressed="recipe.id === selectedId"
          @click="selectedId = recipe.id"
        >
          <img
            v-if="recipe.previewUrl && !failedPreviewIds.has(recipe.id)"
            :src="recipe.previewUrl"
            :alt="`${recipe.title || '配方'} 预览图`"
            class="size-11 shrink-0 rounded-(--cv-radius-sm) object-cover"
            loading="lazy"
            @error="markPreviewFailed(recipe.id)"
          >
          <span
            v-else
            class="flex size-11 shrink-0 items-center justify-center rounded-(--cv-radius-sm) bg-(--cv-surface-container-highest) text-(--cv-on-surface-variant)"
          >
            <i class="fa-solid fa-image" aria-hidden="true" />
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-(--cv-space-2xs)">
            <span class="min-w-0 overflow-hidden text-(length:--cv-font-size-xs) text-ellipsis whitespace-nowrap text-(--cv-on-surface)" :title="recipe.title">
              {{ recipe.title || '未命名配方' }}
            </span>
            <span class="min-w-0 overflow-hidden text-(length:--cv-font-size-xs) text-ellipsis whitespace-nowrap text-(--cv-on-surface-variant)">
              {{ describeRecipe(recipe) }}
            </span>
          </span>
          <i
            v-if="recipe.id === selectedId"
            class="fa-solid fa-circle-check shrink-0 text-(length:--cv-font-size-xs) text-(--cvp-primary-color)"
            aria-hidden="true"
          />
        </button>

        <!-- 首屏加载中 -->
        <div
          v-if="isInitialLoading"
          class="flex min-h-[12rem] items-center justify-center gap-(--cv-space-sm) text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
        >
          <i class="fa-solid fa-spinner animate-spin" aria-hidden="true" />
          正在加载配方…
        </div>

        <!-- 请求失败 -->
        <div
          v-else-if="errorMessage"
          class="flex min-h-[12rem] flex-col items-center justify-center gap-(--cv-space-md) px-(--cv-space-xl) text-center text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
        >
          <span>{{ errorMessage }}</span>
          <Button label="重试" severity="secondary" variant="text" size="small" @click="reload()" />
        </div>

        <!-- 空结果 -->
        <div
          v-else-if="!recipes.length"
          class="flex min-h-[12rem] items-center justify-center px-(--cv-space-xl) text-center text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)"
        >
          {{
            searchKeyword
              ? '没有匹配的配方（若 ComfyUI 刚启动，搜索索引可能仍在构建）'
              : 'LoRA Manager 中还没有配方，可先在管理器里保存一个配方'
          }}
        </div>
      </div>

      <!-- 加载更多 -->
      <div v-if="hasMore && !errorMessage" class="flex items-center justify-center">
        <Button
          :label="isLoadingMore ? '加载中…' : `加载更多（已显示 ${recipes.length} / ${total}）`"
          severity="secondary"
          variant="text"
          size="small"
          :disabled="isLoadingMore"
          @click="loadMore()"
        />
      </div>

      <!-- 选中配方摘要 + 触发词选项 -->
      <div class="flex flex-col gap-(--cv-space-md)">
        <div
          v-if="!props.loraOptions.length"
          class="leading-[1.5] text-(length:--cv-font-size-xs) text-(--cvp-primary-color)"
        >
          LoRA 库尚未加载，导入的 LoRA 会全部处于禁用状态，建议先关闭本窗口刷新 LoRA 库
        </div>
        <div v-if="selectedImportInfo" class="leading-[1.5] text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
          将导入 {{ selectedImportInfo.total }} 个 LoRA<template v-if="selectedImportInfo.missing">
            ，其中 {{ selectedImportInfo.missing }} 个本地缺失（导入后禁用）</template
          >；导入到新分组后会自动切换为当前使用
        </div>
        <div v-else class="leading-[1.5] text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
          选择一个配方后可导入到新分组或替换当前分组
        </div>
        <label
          class="inline-flex cursor-pointer items-center gap-(--cv-space-md) text-(length:--cv-font-size-xs) text-(--cv-on-surface)"
        >
          <Checkbox v-model="shouldFetchTriggerWords" binary />
          <span class="min-w-0 leading-[1.35]">导入后自动获取触发词（需 ComfyUI-Lora-Manager）</span>
        </label>
      </div>
    </div>
    <template #footer>
      <div class="cv-confirm-actions">
        <Button label="取消" text @click="visible = false" />
        <Button
          label="替换当前分组"
          severity="secondary"
          outlined
          :disabled="!selectedRecipe"
          @click="emitImport('replace')"
        />
        <Button
          label="导入到新分组"
          icon="fa-solid fa-file-import"
          :disabled="!selectedRecipe"
          @click="emitImport('new')"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';

import CvMiniButton from '@/panel/components/CvMiniButton.vue';
import {
  COMFYUI_RECIPE_SORT_OPTIONS,
  countImportedRecipeLoras,
  createLoraOptionIndex,
  fetchComfyUILoraRecipes,
  type ComfyUILoraRecipe,
  type ComfyUILoraRecipeSort,
} from '@/services/comfyui/lora-recipes';

/** 弹窗尺寸 */
const DIALOG_STYLE = {
  width: '30rem',
  maxWidth: 'calc(100vw - 2rem)',
} as const;

/** 搜索输入防抖时长 */
const SEARCH_DEBOUNCE_MS = 300;

const visible = defineModel<boolean>('visible', { required: true });

const props = defineProps<{
  /** ComfyUI 地址 */
  comfyuiUrl: string;
  /** 当前 LoRA 库选项（用于统计配方在本地已有的条目） */
  loraOptions: readonly { value: string }[];
}>();

const emit = defineEmits<{
  /** 确认导入：选中的配方、导入方式与是否随后获取触发词 */
  import: [payload: { recipe: ComfyUILoraRecipe; mode: 'new' | 'replace'; fetchTriggerWords: boolean }];
}>();

const sortOptions = [...COMFYUI_RECIPE_SORT_OPTIONS];

const searchInput = ref('');
const searchKeyword = ref('');
const sortBy = ref<ComfyUILoraRecipeSort>('date');
/** 添加后是否自动获取触发词（跨次打开保留上次选择） */
const shouldFetchTriggerWords = ref(true);

const recipes = ref<ComfyUILoraRecipe[]>([]);
const selectedId = ref<string | null>(null);
const page = ref(1);
const total = ref(0);
const totalPages = ref(0);
const isInitialLoading = ref(false);
const isLoadingMore = ref(false);
const errorMessage = ref<string | null>(null);
/** 预览图加载失败的配方 ID（回退占位图标，避免反复请求坏地址） */
const failedPreviewIds = ref<ReadonlySet<string>>(new Set());

/** 请求序号：丢弃切换关键词/排序后迟到的响应 */
let requestToken = 0;

const selectedRecipe = computed(() => recipes.value.find(recipe => recipe.id === selectedId.value));
const hasMore = computed(() => page.value < totalPages.value);
/** LoRA 选项索引（列表内所有配方共用） */
const optionIndex = computed(() => createLoraOptionIndex(props.loraOptions.map(option => option.value)));
/** 选中配方的导入明细（参与导入的条数与本地命中数） */
const selectedImportInfo = computed(() => {
  const recipe = selectedRecipe.value;
  if (!recipe) return null;
  const importable = recipe.loras.filter(lora => !lora.excluded);
  const available = countImportedRecipeLoras(recipe.loras, optionIndex.value);
  return { total: importable.length, missing: importable.length - available };
});

watch(visible, opened => {
  if (!opened) return;
  selectedId.value = null;
  failedPreviewIds.value = new Set();
  reload();
});

// 搜索输入防抖后再请求，避免每个字符打一次 ComfyUI
const applySearch = useDebounceFn((value: string) => {
  const keyword = value.trim();
  if (keyword === searchKeyword.value) return;
  searchKeyword.value = keyword;
  reload();
}, SEARCH_DEBOUNCE_MS);

watch(searchInput, value => applySearch(value));
watch(sortBy, () => reload());

/**
 * 重新拉取第一页（换关键词/排序或手动刷新）
 */
function reload(): void {
  void loadRecipes(false);
}

/**
 * 追加下一页
 */
function loadMore(): void {
  void loadRecipes(true);
}

/**
 * 拉取配方列表
 * @param append 是否追加到现有列表（否则替换）
 */
async function loadRecipes(append: boolean): Promise<void> {
  const baseUrl = props.comfyuiUrl.trim();
  if (!baseUrl) {
    errorMessage.value = '请先填写 ComfyUI URL';
    return;
  }

  const token = ++requestToken;
  if (append) isLoadingMore.value = true;
  else isInitialLoading.value = true;
  errorMessage.value = null;

  try {
    const result = await fetchComfyUILoraRecipes(baseUrl, {
      page: append ? page.value + 1 : 1,
      search: searchKeyword.value,
      sortBy: sortBy.value,
    });
    if (token !== requestToken) return;
    recipes.value = append ? [...recipes.value, ...result.items] : result.items;
    page.value = result.page;
    total.value = result.total;
    totalPages.value = result.totalPages;
  } catch (error) {
    if (token !== requestToken) return;
    const message = error instanceof Error ? error.message : '获取配方列表失败';
    if (append) toastr.error(message);
    else {
      recipes.value = [];
      errorMessage.value = message;
    }
    console.error('[ComfyUILoraRecipeDialog]', error);
  } finally {
    if (token === requestToken) {
      isInitialLoading.value = false;
      isLoadingMore.value = false;
    }
  }
}

/**
 * 描述配方副标题（底模、LoRA 数量与本地命中情况、文件夹）
 * @param recipe 配方
 * @returns 副标题文本
 */
function describeRecipe(recipe: ComfyUILoraRecipe): string {
  const parts: string[] = [];
  if (recipe.baseModel) parts.push(recipe.baseModel);
  const importable = recipe.loras.filter(lora => !lora.excluded);
  if (importable.length) {
    const available = countImportedRecipeLoras(recipe.loras, optionIndex.value);
    parts.push(`${importable.length} 个 LoRA（${available} 个本地已有）`);
  }
  if (recipe.folder) parts.push(recipe.folder);
  return parts.join(' · ') || '无 LoRA';
}

/**
 * 标记预览图加载失败
 * @param id 配方 ID
 */
function markPreviewFailed(id: string): void {
  const next = new Set(failedPreviewIds.value);
  next.add(id);
  failedPreviewIds.value = next;
}

/**
 * 确认导入并关闭弹窗
 * @param mode 导入方式（新建分组 / 替换当前分组）
 */
function emitImport(mode: 'new' | 'replace'): void {
  const recipe = selectedRecipe.value;
  if (!recipe) return;
  emit('import', { recipe, mode, fetchTriggerWords: shouldFetchTriggerWords.value });
  visible.value = false;
}
</script>
