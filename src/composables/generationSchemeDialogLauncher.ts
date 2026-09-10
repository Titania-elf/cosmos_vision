import InlineGenerationSchemeDialog from '@/panel/components/comfyui/InlineGenerationSchemeDialog.vue';
import type { InlinePromptSnapshot } from '@/composables/inlineImageLightbox';
import { createApp, type App } from 'vue';

/**
 * 生图方案弹窗的命令式入口
 *
 * 画廊已改为命令式 DOM（聊天内零 Vue），但弹窗本体继续用 Vue 组件：
 * 它挂到 #cosmos_vision 根容器（面板域，ST 永不重写），不在聊天 DOM 里，
 * 所有权干净，无 subTree 崩溃风险。
 *
 * 每次打开创建独立小 app 并复用主应用的 pinia / PrimeVue 配置（经
 * provideDialogPlugins 注入，避免依赖入口模块的顶层副作用），关闭即销毁。
 */

/** 弹窗宿主 id（#cosmos_vision 由插件入口创建） */
const HOST_ID = 'cosmos_vision';
/** 当前弹窗条目（宿主元素 + app 实例） */
let activeEntry: { element: HTMLElement; app: ReturnType<typeof createApp> } | null = null;
/** 主应用插件安装器：向新小 app 安装主应用的插件组合 */
type DialogPluginInstaller = (app: App) => void;

/** 主应用插件（pinia 单例 + PrimeVue 配置），入口注入 */
let dialogInstalls: DialogPluginInstaller[] = [];

/**
 * 注入主应用插件安装器（入口 index.ts 调用一次）
 * @param installs 在新小 app 上执行的插件安装闭包
 */
export function provideDialogPlugins(installs: DialogPluginInstaller[]): void {
  dialogInstalls = installs;
}

/**
 * 打开生图方案弹窗（命令式，画廊 DOM 渲染器调用）
 * @param snapshot 当前焦点图片的提示词快照
 */
export function openGenerationSchemeDialog(snapshot: InlinePromptSnapshot | null | undefined): void {
  if (!snapshot) return;
  const root = document.getElementById(HOST_ID);
  if (!root) return;

  closeGenerationSchemeDialog();

  const container = document.createElement('div');
  container.dataset.cvDialogApp = 'generation-scheme';
  root.appendChild(container);

  const app: App = createApp({
    setup() {
      const visible = ref(true);
      watch(visible, value => {
        if (!value) closeGenerationSchemeDialog();
      });
      return () => h(InlineGenerationSchemeDialog, {
        visible: visible.value,
        'onUpdate:visible': (value: boolean) => { visible.value = value; },
        snapshot: snapshot ?? undefined,
      });
    },
  });
  for (const install of dialogInstalls) {
    install(app);
  }
  app.mount(container);
  activeEntry = { element: container, app };
}

/**
 * 关闭并销毁当前弹窗（如存在）
 */
export function closeGenerationSchemeDialog(): void {
  if (!activeEntry) return;
  const { element, app } = activeEntry;
  activeEntry = null;
  app.unmount();
  element.remove();
}
