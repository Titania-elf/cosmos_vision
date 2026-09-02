<template>
  <Teleport to="body">
    <!-- 居中弹窗 -->
    <Transition name="cv-llm-inspector-pop">
      <aside
        v-if="open"
        class="cv-llm-inspector cosmos-vision-root"
        :class="{ [DARK_CLASS]: darkMode, 'cv-llm-inspector--rail-collapsed': railCollapsed }"
        role="dialog"
        aria-label="LLM 请求监视"
      >
        <!-- 头部 -->
        <header class="cv-llm-inspector-header">
          <div class="flex min-w-0 items-center gap-(--cv-space-sm)">
            <button
              type="button"
              class="cv-llm-inspector-icon-btn"
              :aria-label="railCollapsed ? '展开请求记录侧栏' : '收起请求记录侧栏'"
              :title="railCollapsed ? '展开请求记录侧栏' : '收起请求记录侧栏'"
              @click="toggleRail"
            >
              <i
                class="fa-solid"
                :class="railCollapsed ? 'fa-angles-right' : 'fa-angles-left'"
                aria-hidden="true"
              />
            </button>
            <i class="fa-solid fa-comments text-(length:--cv-font-size-base)" aria-hidden="true" />
            <span class="text-(length:--cv-font-size-md) font-semibold text-(--cv-on-surface)">LLM 请求监视</span>
          </div>
          <div class="flex items-center gap-(--cv-space-sm)">
            <button
              type="button"
              class="cv-llm-inspector-icon-btn"
              :disabled="!sessions.length"
              aria-label="清空记录"
              title="清空记录"
              @click="clearSessions"
            >
              <i class="fa-solid fa-trash" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="cv-llm-inspector-icon-btn"
              aria-label="关闭"
              title="关闭"
              @click="open = false"
            >
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        </header>

        <!-- 主体：会话列表侧栏 + 详情 -->
        <div class="cv-llm-inspector-body">
          <!-- 会话列表侧栏：可收起，收起后仅留状态圆点窄条 -->
          <nav class="cv-llm-inspector-list" aria-label="请求记录">
            <div v-if="!sessions.length && !railCollapsed" class="cv-llm-inspector-empty">
              <i class="fa-regular fa-comment-dots" aria-hidden="true" />
              <span>暂无请求记录</span>
              <span class="cv-llm-inspector-empty-hint">选段生图后，将在此实时查看 LLM 交互</span>
            </div>
            <button
              v-for="session in sessions"
              :key="session.id"
              type="button"
              class="cv-llm-inspector-list-item"
              :class="{ 'cv-llm-inspector-list-item--active': session.id === selectedId }"
              :aria-label="railCollapsed ? session.label : undefined"
              :title="railCollapsed ? `${session.label}（${formatTime(session.startedAt)}）` : session.label"
              @click="selectedId = session.id"
            >
              <span class="cv-llm-inspector-list-status">
                <i
                  class="fa-solid"
                  :class="statusIconClass(session.status)"
                  :style="session.status === 'running' ? undefined : { color: statusColor(session.status) }"
                  aria-hidden="true"
                />
              </span>
              <span v-if="!railCollapsed" class="cv-llm-inspector-list-text">
                <span class="cv-llm-inspector-list-label" :title="session.label">{{ session.label }}</span>
                <span class="cv-llm-inspector-list-meta">{{ formatTime(session.startedAt) }} · {{ session.model }}</span>
              </span>
            </button>
          </nav>

          <!-- 详情 -->
          <div class="cv-llm-inspector-detail">
            <div v-if="!selectedSession" class="cv-llm-inspector-empty">
              <i class="fa-regular fa-hand-point-left" aria-hidden="true" />
              <span>选择会话查看交互详情</span>
            </div>
            <template v-else>
              <!-- 详情头部：元信息 -->
              <div class="cv-llm-inspector-meta">
                <div class="cv-llm-inspector-meta-title" :title="selectedSession.label">
                  {{ selectedSession.label }}
                </div>
                <div class="cv-llm-inspector-meta-chips">
                  <span class="cv-llm-inspector-chip" :style="{ color: statusColor(selectedSession.status) }">
                    <i class="fa-solid" :class="statusIconClass(selectedSession.status)" aria-hidden="true" />
                    {{ statusLabel(selectedSession) }}
                  </span>
                  <span class="cv-llm-inspector-chip" :title="selectedSession.endpoint">
                    <i class="fa-solid fa-plug" aria-hidden="true" />
                    {{ selectedSession.model }}
                  </span>
                  <span class="cv-llm-inspector-chip">
                    <i class="fa-solid fa-user-gear" aria-hidden="true" />
                    {{ selectedSession.accountName }}
                  </span>
                  <span class="cv-llm-inspector-chip">
                    <i class="fa-solid" :class="selectedSession.streamEnabled ? 'fa-bolt' : 'fa-hourglass'" aria-hidden="true" />
                    {{ selectedSession.streamEnabled ? '流式' : '非流式' }}
                  </span>
                  <span class="cv-llm-inspector-chip">
                    <i class="fa-regular fa-clock" aria-hidden="true" />
                    {{ formatTime(selectedSession.startedAt) }}
                  </span>
                </div>
              </div>

              <!-- 对话流 -->
              <div ref="streamEl" class="cv-llm-inspector-stream">
                <!-- 发送的指令：默认折叠，点击展开完整内容 -->
                <div
                  v-for="(prompt, index) in selectedSession.prompts"
                  :key="index"
                  class="cv-llm-inspector-bubble cv-llm-inspector-bubble--sent"
                >
                  <button
                    type="button"
                    class="cv-llm-inspector-bubble-header"
                    @click="togglePromptExpanded(selectedSession.id, index)"
                  >
                    <span class="cv-llm-inspector-role-badge" :class="`cv-llm-inspector-role--${prompt.role}`">
                      {{ prompt.role }}
                    </span>
                    <span class="cv-llm-inspector-bubble-preview" :class="{ 'cv-llm-inspector-bubble-preview--collapsed': !isPromptExpanded(selectedSession.id, index) }">
                      {{ prompt.content.trim() || '(空)' }}
                    </span>
                    <span class="cv-llm-inspector-bubble-toggle">
                      <i
                        class="fa-solid"
                        :class="isPromptExpanded(selectedSession.id, index) ? 'fa-chevron-up' : 'fa-chevron-down'"
                        aria-hidden="true"
                      />
                      {{ isPromptExpanded(selectedSession.id, index) ? '收起' : `查看完整指令 · ${prompt.content.length} 字` }}
                    </span>
                  </button>
                  <div
                    v-if="isPromptExpanded(selectedSession.id, index)"
                    class="cv-llm-inspector-bubble-content"
                  >{{ prompt.content }}</div>
                </div>

                <!-- 思考过程：流式时展开实时滚动，完成后折叠 -->
                <div
                  v-if="selectedSession.thinkingText"
                  class="cv-llm-inspector-bubble cv-llm-inspector-bubble--thinking"
                >
                  <button
                    type="button"
                    class="cv-llm-inspector-bubble-header"
                    @click="toggleThinkingExpanded(selectedSession.id)"
                  >
                    <span class="cv-llm-inspector-role-badge cv-llm-inspector-role--thinking">
                      <i v-if="selectedSession.status === 'running'" class="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                      <i v-else class="fa-solid fa-brain" aria-hidden="true" />
                      {{ selectedSession.status === 'running' ? '正在思考' : '思考过程' }}
                    </span>
                    <span class="cv-llm-inspector-bubble-toggle">
                      <i
                        class="fa-solid"
                        :class="isThinkingExpanded(selectedSession.id) ? 'fa-chevron-up' : 'fa-chevron-down'"
                        aria-hidden="true"
                      />
                      {{ isThinkingExpanded(selectedSession.id) ? '收起' : `展开 · ${selectedSession.thinkingText.length} 字` }}
                    </span>
                  </button>
                  <div v-if="isThinkingExpanded(selectedSession.id)" class="cv-llm-inspector-thinking-content">
                    {{ selectedSession.thinkingText }}
                  </div>
                </div>

                <!-- 模型回复正文 -->
                <div class="cv-llm-inspector-bubble cv-llm-inspector-bubble--received">
                  <div class="cv-llm-inspector-bubble-header">
                    <span class="cv-llm-inspector-role-badge cv-llm-inspector-role--assistant">
                      <i v-if="selectedSession.status === 'running'" class="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                      <i v-else class="fa-solid fa-robot" aria-hidden="true" />
                      回复
                    </span>
                  </div>
                  <div v-if="selectedSession.contentText" class="cv-llm-inspector-bubble-content">
                    {{ selectedSession.contentText }}<span
                      v-if="selectedSession.status === 'running'"
                      class="cv-llm-inspector-cursor"
                      aria-hidden="true"
                    />
                  </div>
                  <div v-else-if="selectedSession.status === 'running'" class="cv-llm-inspector-waiting">
                    <i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true" />
                    等待模型响应…
                  </div>
                </div>

                <!-- 失败原因 -->
                <div v-if="selectedSession.status === 'failed'" class="cv-llm-inspector-bubble cv-llm-inspector-bubble--error">
                  <div class="cv-llm-inspector-bubble-header">
                    <span class="cv-llm-inspector-role-badge cv-llm-inspector-role--error">
                      <i class="fa-solid fa-circle-exclamation" aria-hidden="true" />
                      生成失败
                    </span>
                  </div>
                  <div class="cv-llm-inspector-bubble-content">{{ selectedSession.error || '未知错误' }}</div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { DARK_CLASS } from '@/constants/default-settings';
import { useLlmInspectorStore, type LlmInspectorSession } from '@/store/llm-inspector';
import { useSettingsStore } from '@/store/settings';

const settingsStore = useSettingsStore();
const { darkMode } = storeToRefs(settingsStore);

const inspectorStore = useLlmInspectorStore();
const { sessions } = storeToRefs(inspectorStore);

/** 弹窗开合状态（由父级悬浮球次级菜单驱动） */
const open = defineModel<boolean>('open', { default: false });
/** 会话列表侧栏收起状态（收起后仅留状态圆点窄条） */
const railCollapsed = ref(false);
/** 当前选中会话 ID */
const selectedId = ref<string | null>(null);
/** 指令气泡展开态（key: `${sessionId}:${index}`），折叠是默认态 */
const expandedPrompts = ref<Record<string, boolean>>({});
/** 思考块用户手动展开态；未手动操作时跟随流式（运行中展开） */
const thinkingToggles = ref<Record<string, boolean>>({});
/** 对话流滚动容器 */
const streamEl = ref<HTMLElement | null>(null);

const selectedSession = computed<LlmInspectorSession | null>(
  () => sessions.value.find(session => session.id === selectedId.value) ?? null,
);

/** 打开弹窗；无选中会话时默认选中最新一条 */
watch(open, visible => {
  if (visible && !selectedId.value && sessions.value.length) {
    selectedId.value = sessions.value[0]!.id;
  }
});

/** 切换会话列表侧栏收起状态 */
function toggleRail(): void {
  railCollapsed.value = !railCollapsed.value;
}

/** 新会话开始时：未选中或当前选中已结束时自动跳转到新会话 */
watch(
  () => sessions.value[0]?.id,
  (newestId, previousId) => {
    if (!newestId || newestId === previousId) return;
    const current = selectedSession.value;
    if (!open.value || !current || current.status !== 'running') {
      selectedId.value = newestId;
    }
  },
);

/** 选中会话变化时滚动到对话流底部 */
watch(
  () => [selectedId.value, selectedSession.value?.contentText, selectedSession.value?.thinkingText],
  () => {
    void nextTick(scrollStreamToBottom);
  },
);

/** 流式内容更新时：若用户停在底部附近则保持跟随 */
watch(
  () => [selectedSession.value?.contentText.length, selectedSession.value?.thinkingText.length],
  (current, previous) => {
    if (current === previous) return;
    void nextTick(() => {
      if (isStreamNearBottom()) scrollStreamToBottom();
    });
  },
);

/** Escape 关闭抽屉 */
watch(open, active => {
  if (active) window.addEventListener('keydown', handleEscape);
  else window.removeEventListener('keydown', handleEscape);
});

function handleEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}

/**
 * 判断指令气泡是否展开
 * @param sessionId 会话 ID
 * @param index 指令序号
 */
function isPromptExpanded(sessionId: string, index: number): boolean {
  return Boolean(expandedPrompts.value[`${sessionId}:${index}`]);
}

/**
 * 切换指令气泡展开态
 * @param sessionId 会话 ID
 * @param index 指令序号
 */
function togglePromptExpanded(sessionId: string, index: number): void {
  const key = `${sessionId}:${index}`;
  expandedPrompts.value[key] = !expandedPrompts.value[key];
}

/**
 * 判断思考块是否展开（用户手动切换优先，默认运行中展开、完成后折叠）
 * @param sessionId 会话 ID
 */
function isThinkingExpanded(sessionId: string): boolean {
  const manual = thinkingToggles.value[sessionId];
  if (manual !== undefined) return manual;
  const session = sessions.value.find(item => item.id === sessionId);
  return session?.status === 'running';
}

/**
 * 切换思考块展开态
 * @param sessionId 会话 ID
 */
function toggleThinkingExpanded(sessionId: string): void {
  thinkingToggles.value[sessionId] = !isThinkingExpanded(sessionId);
}

/** 清空会话记录并重置选中 */
function clearSessions(): void {
  inspectorStore.clearSessions();
  selectedId.value = null;
  expandedPrompts.value = {};
  thinkingToggles.value = {};
}

/**
 * 读取状态图标 class（running 时叠加自转动画由 css 类处理）
 * @param status 会话状态
 */
function statusIconClass(status: LlmInspectorSession['status']): string {
  if (status === 'running') return 'fa-circle-notch cv-llm-inspector-spinning';
  return status === 'completed' ? 'fa-circle-check' : 'fa-circle-xmark';
}

/**
 * 读取状态颜色
 * @param status 会话状态
 */
function statusColor(status: LlmInspectorSession['status']): string {
  if (status === 'running') return 'var(--cv-primary)';
  return status === 'completed' ? 'var(--cvp-green-500)' : 'var(--cvp-red-500)';
}

/**
 * 读取状态文案（含耗时）
 * @param session 会话
 */
function statusLabel(session: LlmInspectorSession): string {
  if (session.status === 'running') return '生成中';
  const duration = session.finishedAt ? session.finishedAt - session.startedAt : 0;
  const suffix = session.status === 'completed' ? ` · ${formatDuration(duration)}` : '';
  return `${session.status === 'completed' ? '完成' : '失败'}${suffix}`;
}

/**
 * 格式化时刻
 * @param timestamp 时间戳
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 格式化耗时
 * @param durationMs 毫秒
 */
function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
}

/**
 * 判断对话流是否滚动在底部附近（跟随阈值 80px）
 */
function isStreamNearBottom(): boolean {
  const el = streamEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

/**
 * 滚动对话流到底部
 */
function scrollStreamToBottom(): void {
  const el = streamEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape);
});
</script>

<style src="@/styles/llm-inspector.css"></style>
