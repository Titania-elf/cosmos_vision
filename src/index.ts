import '@/global.css';
import '@/styles/inline-image.css';
import '@/styles/inline-lightbox.css';
import App from '@/App.vue';
import { DARK_CLASS } from '@/constants/default-settings';
import { cosmosPrimePt } from '@/services/primevue/primevue-pt';
import { cosmosPrimePreset } from '@/services/primevue/primevue-theme';
import { syncThemeColorToPrimary } from '@/services/primevue/theme-adapter';
import { whenSillyTavernReady } from '@/services/sillytavern/theme';
import PrimeVue from 'primevue/config';
import { createPinia, type Pinia } from 'pinia';
import { provideDialogPlugins } from '@/composables/generationSchemeDialogLauncher';

/**
 * CosmosVision 扩展入口
 * 在 ST 加载完成后挂载到 #extensions_settings,使用 jQuery 兼容 ST 的生命周期
 */
const app = createApp(App);

// PrimeUI 许可证在构建时通过 vite.config.ts 的 define 注入
declare const __PRIMEUI_LICENSE__: string;
const primeUiLicense = __PRIMEUI_LICENSE__ || undefined;

/** 全局共享 pinia 实例（命令式弹窗小 app 复用，保证设置 store 单例） */
const pinia: Pinia = createPinia();
app.use(pinia);

/** 主应用 PrimeVue 配置（命令式弹窗小 app 复用同一套主题/PT/zIndex） */
const primeVueOptions = {
  license: primeUiLicense,
  theme: {
    preset: cosmosPrimePreset,
    options: {
      // 独立 design token 命名空间（cvp），避免与同页其他 PrimeVue 扩展默认 token 串扰
      prefix: 'cvp',
      darkModeSelector: `.cosmos-vision-root.${DARK_CLASS}`,
      // 关闭 cssLayer：让 PrimeVue 规则保持 unlayered，凭类选择器特异性覆盖 ST 全局标签规则
      cssLayer: false,
    },
  },
  pt: cosmosPrimePt,
  // 局部 :pt 的 class/style 与全局 PT 合并（避免默认 false 覆盖根类名）
  ptOptions: {
    mergeProps: true,
  },
  // overlay/menu 必须高于全屏工作流编辑器 (z-99999)；modal 保持 ST 对话框之上
  zIndex: {
    modal: 3101,
    overlay: 100100,
    menu: 100100,
  },
} as const;

app.use(PrimeVue, primeVueOptions);

// 命令式生图方案弹窗复用主应用插件（pinia 单例 + PrimeVue 配置）
provideDialogPlugins([next => next.use(pinia), next => next.use(PrimeVue, primeVueOptions)]);

$(async () => {
  // 等待 ST APP_READY 后再读取 --SmartThemeQuoteColor，避免读到空串导致主题色退回灰阶
  await whenSillyTavernReady();
  syncThemeColorToPrimary();
  const $container = $('<div id="cosmos_vision">').appendTo('#extensions_settings');
  app.mount($container[0]);
});
