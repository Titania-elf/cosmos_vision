<template>
  <Dialog
    v-model:visible="visible"
    class="cv-profiles-sync-dialog"
    modal
    :draggable="false"
    header="从其他聊天同步档案"
    :style="{ width: '36rem', maxWidth: 'calc(100dvw - 2rem)' }"
  >
    <div class="flex flex-col gap-(--cv-space-xl)">
      <div class="cv-field-hint">
        仅列出同角色卡或同群组的其他聊天。同步为一次性复制，不修改来源聊天，后续编辑互不影响。
      </div>
      <label class="cv-field">
        <span>来源聊天</span>
        <Select
          v-model="sourceChatId"
          :options="chatOptions"
          option-label="label"
          option-value="chatId"
          :loading="loadingList"
          :disabled="loadingList || confirming"
          filter
          fluid
          placeholder="请选择聊天记录"
          empty-filter-message="没有匹配的聊天"
          empty-message="没有其他聊天记录"
        />
      </label>
      <div v-if="loadingList" class="cv-field-hint" role="status">正在读取聊天列表...</div>
      <div v-else-if="!chats.length && !error" class="cv-field-hint">当前角色卡或群组下没有其他已保存的聊天。</div>
      <div v-if="error" class="text-(--cvp-red-500)" role="alert">
        {{ error }}
        <Button v-if="!sourceChatId && targetScope" label="重试" text size="small" @click="loadChatList" />
        <Button v-else-if="sourceChatId" label="重试" text size="small" @click="loadSourceProfiles" />
      </div>
      <label class="cv-field">
        <span>同步范围</span>
        <Select
          v-model="syncKind"
          :options="KIND_OPTIONS"
          option-label="label"
          option-value="value"
          :disabled="confirming"
          fluid
        />
      </label>
      <div v-if="loadingSource" class="cv-field-hint" role="status">正在读取来源档案...</div>
      <div v-else-if="sourceChatId && !error" class="flex flex-col gap-(--cv-space-md)">
        <div class="flex flex-wrap items-center justify-between gap-(--cv-space-sm)">
          <span>选择档案</span>
          <div class="flex gap-(--cv-space-sm)">
            <Button label="全选" text size="small" :disabled="confirming" @click="selectAll" />
            <Button label="取消全选" text size="small" :disabled="confirming" @click="selectedIndices = []" />
          </div>
        </div>
        <div v-if="!filteredSource.length" class="cv-field-hint">来源聊天没有此范围的有效人物档案。</div>
        <div class="custom-scrollbar flex max-h-72 flex-col gap-(--cv-space-sm) overflow-y-auto">
          <label
            v-for="{ person, index } in filteredSource"
            :key="index"
            class="flex min-w-0 cursor-pointer items-start gap-(--cv-space-md) rounded-(--cv-radius-sm) border-(length:--cv-border-width) border-solid border-(--cv-surface-variant) bg-(--cv-surface-container-low) p-(--cv-space-lg)"
          >
            <Checkbox v-model="selectedIndices" :value="index" :disabled="confirming" :aria-label="`同步${person.name}`" />
            <span class="flex min-w-0 flex-1 flex-col gap-(--cv-space-xs)">
              <span class="flex flex-wrap items-center gap-(--cv-space-sm)">
                <strong class="break-all">{{ person.name }}</strong>
                <span class="cv-field-hint">{{ person.kind === 'user' ? '用户' : '角色' }}</span>
                <span class="cv-field-hint">{{ getActionLabel(person) }}</span>
              </span>
              <span class="truncate text-(length:--cv-font-size-xs) text-(--cv-on-surface-variant)">
                {{ person.staticTags || '未设置固定 tag' }}
              </span>
            </span>
          </label>
        </div>
      </div>
      <label class="cv-field">
        <span>同步方式</span>
        <Select
          v-model="syncMode"
          :options="MODE_OPTIONS"
          option-label="label"
          option-value="value"
          :disabled="confirming"
          fluid
        />
      </label>
      <div class="cv-field-hint">完整复制模板及其来源引用；角色描述、用户人设和世界书仍按原绑定动态读取。</div>
      <div v-if="selectedProfiles.length" class="cv-field-hint" role="status">{{ summary }}</div>
      <div v-if="conflictCount" class="cv-field-hint">同类型同名档案存在多条，冲突项将跳过，不自动猜测覆盖对象。</div>
    </div>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-(--cv-space-sm)">
        <Button label="取消" outlined @click="visible = false" />
        <Button
          label="确认同步"
          icon="fa-solid fa-arrows-rotate"
          :loading="confirming"
          :disabled="!canSync"
          @click="confirmSync"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { event_types, eventSource } from '@sillytavern/script';
import type { PromptPerson, PromptPersonKind } from '@/constants/novelai';
import { readChatProfiles, readProfilesFromMetadata } from '@/services/prompt-profiles/chat-store';
import { previewChatProfileSync, type ChatProfileSyncMode } from '@/services/prompt-profiles/chat-sync';
import { getCurrentChatScope, isSameChatScope, listPastChats, readPastChatMetadata, type ChatScope, type PastChatOption } from '@/services/sillytavern/chats';

const props = defineProps<{ kind: PromptPersonKind; profiles: PromptPerson[] }>();
const visible = defineModel<boolean>('visible', { default: false });
const emit = defineEmits<{
  sync: [selected: PromptPerson[], mode: ChatProfileSyncMode, scope: ChatScope];
  refresh: [];
}>();
const showConfirm = inject<(options: {
  title?: string;
  message: string;
  acceptLabel?: string;
  cancelLabel?: string;
  severity?: string;
}) => Promise<boolean>>('showConfirm');

const KIND_OPTIONS = [
  { label: '角色档案', value: 'character' },
  { label: '用户档案', value: 'user' },
  { label: '角色 + 用户', value: 'all' },
];
const MODE_OPTIONS = [
  { label: '仅补充缺失档案', value: 'missing' },
  { label: '新增并覆盖同名档案', value: 'overwrite' },
];
const targetScope = ref<ChatScope | null>(null);
const chats = ref<PastChatOption[]>([]);
const sourceChatId = ref<string | null>(null);
const sourceProfiles = ref<PromptPerson[]>([]);
const selectedIndices = ref<number[]>([]);
const syncKind = ref<PromptPersonKind | 'all'>('character');
const syncMode = ref<ChatProfileSyncMode>('missing');
const loadingList = ref(false);
const loadingSource = ref(false);
const confirming = ref(false);
const error = ref('');
let listController: AbortController | null = null;
let sourceController: AbortController | null = null;
let session = 0;

const chatOptions = computed(() => chats.value.map(chat => ({
  ...chat,
  label: chat.updatedAt ? `${chat.chatId} · ${new Date(chat.updatedAt).toLocaleString()}` : chat.chatId,
})));
const filteredSource = computed(() => sourceProfiles.value
  .map((person, index) => ({ person, index }))
  .filter(({ person }) => syncKind.value === 'all' || person.kind === syncKind.value));
const selectedProfiles = computed(() => filteredSource.value
  .filter(({ index }) => selectedIndices.value.includes(index))
  .map(({ person }) => person));
const preview = computed(() => previewChatProfileSync(props.profiles, selectedProfiles.value, syncMode.value));
const addCount = computed(() => preview.value.filter(item => item.action === 'add').length);
const overwriteCount = computed(() => preview.value.filter(item => item.action === 'overwrite').length);
const skipCount = computed(() => preview.value.filter(item => item.action === 'skip').length);
const conflictCount = computed(() => preview.value.filter(item => item.action === 'conflict').length);
const summary = computed(() => `将新增 ${addCount.value} 个档案，覆盖 ${overwriteCount.value} 个，跳过 ${skipCount.value + conflictCount.value} 个。`);
const canSync = computed(() => Boolean(targetScope.value && sourceChatId.value) && !loadingList.value && !loadingSource.value
  && !confirming.value && !error.value && addCount.value + overwriteCount.value > 0);

watch(visible, value => {
  stopRequests();
  session += 1;
  if (!value) return;
  targetScope.value = getCurrentChatScope();
  chats.value = [];
  sourceChatId.value = null;
  sourceProfiles.value = [];
  selectedIndices.value = [];
  syncKind.value = props.kind;
  syncMode.value = 'missing';
  confirming.value = false;
  error.value = '';
  if (!targetScope.value) {
    error.value = '请先打开一份角色或群组聊天';
    return;
  }
  void loadChatList();
}, { immediate: true });
watch(sourceChatId, () => { void loadSourceProfiles(); });
watch(syncKind, selectAll);

function stopRequests(): void {
  listController?.abort();
  sourceController?.abort();
  loadingList.value = false;
  loadingSource.value = false;
}

function checkTarget(): boolean {
  if (visible.value && isSameChatScope(targetScope.value, getCurrentChatScope())) return true;
  if (visible.value) {
    visible.value = false;
    toastr.info('当前聊天已变化，请重新打开同步弹窗');
  }
  return false;
}

async function loadChatList(): Promise<void> {
  const scope = targetScope.value;
  if (!scope || !checkTarget()) return;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loadingList.value = true;
  error.value = '';
  try {
    const options = await listPastChats(scope, controller.signal);
    if (!controller.signal.aborted && checkTarget()) {
      chats.value = options;
      if (JSON.stringify(props.profiles) !== JSON.stringify(readChatProfiles())) emit('refresh');
    }
  } catch (cause) {
    if (!controller.signal.aborted && checkTarget()) error.value = getErrorMessage(cause);
  } finally {
    if (listController === controller) loadingList.value = false;
  }
}

async function loadSourceProfiles(): Promise<void> {
  sourceController?.abort();
  sourceProfiles.value = [];
  selectedIndices.value = [];
  loadingSource.value = false;
  const scope = targetScope.value;
  const chatId = sourceChatId.value;
  if (!scope || !chatId || !checkTarget()) return;
  const controller = new AbortController();
  sourceController = controller;
  loadingSource.value = true;
  error.value = '';
  try {
    const metadata = await readPastChatMetadata(scope, chatId, controller.signal);
    if (controller.signal.aborted || sourceChatId.value !== chatId || !checkTarget()) return;
    sourceProfiles.value = readProfilesFromMetadata(metadata);
    selectAll();
  } catch (cause) {
    if (!controller.signal.aborted && checkTarget()) error.value = getErrorMessage(cause);
  } finally {
    if (sourceController === controller) loadingSource.value = false;
  }
}

function selectAll(): void {
  selectedIndices.value = filteredSource.value.map(({ index }) => index);
}

function getActionLabel(person: PromptPerson): string {
  const candidates = selectedProfiles.value.includes(person) ? selectedProfiles.value : [...selectedProfiles.value, person];
  const action = previewChatProfileSync(props.profiles, candidates, syncMode.value).find(item => item.source === person)?.action;
  if (action === 'conflict') return '存在同名冲突';
  if (action === 'overwrite') return '覆盖同名档案';
  return action === 'skip' ? '已有同名，跳过' : '新增';
}

async function confirmSync(): Promise<void> {
  if (!canSync.value || !checkTarget()) return;
  const scope = targetScope.value!;
  const requestSession = session;
  const before = JSON.stringify(props.profiles);
  const selected = selectedProfiles.value;
  const mode = syncMode.value;
  confirming.value = true;
  try {
    if (overwriteCount.value) {
      if (!showConfirm) {
        error.value = '确认弹窗不可用，无法执行覆盖';
        return;
      }
      const names = preview.value.filter(item => item.action === 'overwrite').map(item => `「${item.source.name}」`).join('、');
      const accepted = await showConfirm({
        title: '覆盖同名人物档案',
        message: `将用来源档案完整替换 ${names} 的配置，包括固定 tag 和模板条目。当前聊天其他档案保留。`,
        acceptLabel: '确认覆盖并同步',
        cancelLabel: '取消',
        severity: 'danger',
      });
      if (!accepted) return;
    }
    if (requestSession !== session || !checkTarget()) return;
    if (before !== JSON.stringify(props.profiles) || before !== JSON.stringify(readChatProfiles())) {
      emit('refresh');
      toastr.info('当前档案已变化，预览已更新，请重新确认同步');
      return;
    }
    emit('sync', selected, mode, scope);
    visible.value = false;
  } finally {
    if (requestSession === session) confirming.value = false;
  }
}

function getErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') return '读取超时，请重试';
  return cause instanceof Error ? cause.message : '读取聊天失败，请检查连接后重试';
}

const onChatChanged = (): void => {
  if (!visible.value) return;
  visible.value = false;
  stopRequests();
  session += 1;
  toastr.info('当前聊天已变化，请重新打开同步弹窗');
};
eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
onUnmounted(() => {
  stopRequests();
  session += 1;
  eventSource.removeListener(event_types.CHAT_CHANGED, onChatChanged);
});
</script>
