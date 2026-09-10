import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, getCurrentInstance, h, nextTick, type AppContext } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import InlineGalleryRuntimeHost from '@/panel/components/InlineGalleryRuntimeHost.vue';
import { useGalleryRuntimesStore } from '@/store/gallery-runtimes';
import { eventSource, event_types, chat } from '@sillytavern/script';
import type { InlinePromptSnapshot } from '@/composables/inlineImageLightbox';

// 画廊动作链拉入收藏下载模块，其顶层引用全局 JSZip（jsdom 无）
vi.mock('@/services/inline-image/favorites-download', () => ({
  downloadInlineImageFavoritesZip: vi.fn(),
  __esModule: true,
}));

// jsdom 无本地收藏文件服务，收藏列表固定为空
vi.mock('@/services/inline-image/favorites-cache', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/inline-image/favorites-cache')>();
  return {
    ...actual,
    listInlineImageFavoritesBySlot: vi.fn().mockResolvedValue([]),
  };
});

// jsdom 无 IndexedDB，临时图片仓储改为内存空实现
vi.mock('@/services/inline-image/temporary-images', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/inline-image/temporary-images')>();
  return {
    ...actual,
    listTemporaryImages: vi.fn().mockResolvedValue([]),
    pruneTemporaryImages: vi.fn().mockResolvedValue([]),
    saveTemporaryImage: vi.fn().mockResolvedValue([]),
    deleteTemporaryImage: vi.fn().mockResolvedValue(undefined),
  };
});

/**
 * 命令式画廊渲染器回归
 * 验证：二次生图更新、缩略图切换焦点、楼层重渲染恢复、ST 整体重写后零残留
 * 全程无 Vue 组件挂进聊天 DOM（.cv-render 内只有原生节点）
 */

interface ChatStore {
  raw: Record<number, string>;
}

let chatStore: ChatStore;
const blobUrls = new Map<Blob, string>();
let blobUrlSeq = 0;

function flushFrames(times = 6): Promise<void> {
  let remaining = times;
  return (function step(): Promise<void> {
    return nextTick()
      .then(() => new Promise<void>(resolve => { setTimeout(resolve, 0); }))
      .then(() => {
        remaining -= 1;
        return remaining > 0 ? step() : undefined;
      });
  })();
}

function setupTavernHelperMock(store: ChatStore): void {
  const helper = {
    getTavernHelperVersion: () => '4.9.0',
    getChatMessages: (id: number) => [{ message_id: id, message: store.raw[id] ?? '' }],
    setChatMessages: async (messages: Array<{ message_id: number; message?: string }>) => {
      for (const message of messages) {
        if (typeof message.message === 'string') store.raw[message.message_id] = message.message;
      }
    },
  };
  (globalThis as Record<string, unknown>).TavernHelper = helper;
  (window as unknown as Record<string, unknown>).TavernHelper = helper;
}

function buildChatDom(): void {
  document.body.innerHTML = `
    <div id="chat">
      <div class="mes" mesid="0">
        <div class="mes_text"><p>hello world</p></div>
      </div>
    </div>
  `;
}

/**
 * 模拟 ST 楼层重渲染：按当前 raw 重建 .mes_text 段落
 */
function rerenderMesText(messageId: number): void {
  const mes = document.querySelector(`#chat > .mes[mesid="${messageId}"]`)!;
  const mesText = mes.querySelector('.mes_text')!;
  mesText.innerHTML = (chatStore.raw[messageId] ?? '')
    .split(/\r?\n/)
    .map(line => `<p>${line}</p>`)
    .join('');
}

function makeSnapshot(): InlinePromptSnapshot {
  return { positivePrompt: 'a', negativePrompt: 'b', imageSource: 'comfyui' };
}

describe('命令式画廊渲染器回归', () => {
  let app: ReturnType<typeof createApp> | null = null;
  let appHost: HTMLElement | null = null;

  beforeEach(() => {
    chatStore = { raw: { 0: 'hello world' } };
    chat.length = 0;
    chat.push({ mes: 'hello world', is_user: false, swipe_id: 0 });
    setupTavernHelperMock(chatStore);
    buildChatDom();
    blobUrls.clear();
    blobUrlSeq = 0;
    const createObjectUrl = vi.fn((blob: Blob) => {
      const existing = blobUrls.get(blob);
      if (existing) return existing; // 同一 Blob 复用同一 URL（贴近浏览器语义）
      blobUrlSeq += 1;
      const url = `blob:mock/${blobUrlSeq}`;
      blobUrls.set(blob, url);
      return url;
    });
    URL.createObjectURL = createObjectUrl as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(async () => {
    app?.unmount();
    app = null;
    appHost?.remove();
    appHost = null;
    await flushFrames(2);
  });

  async function mountApp(): Promise<void> {
    let capturedAppContext: AppContext | undefined;
    const Root = defineComponent({
      components: { InlineGalleryRuntimeHost },
      setup() {
        capturedAppContext = getCurrentInstance()!.appContext;
        return () => h(InlineGalleryRuntimeHost);
      },
    });
    app = createApp(Root);
    app.use(createPinia());
    app.use(PrimeVue, { license: '' });
    appHost = document.createElement('div');
    document.body.append(appHost);
    app.mount(appHost);
    await flushFrames();
    void capturedAppContext;
    useGalleryRuntimesStore().start();
    await flushFrames();
  }

  it('第二次生成后画廊应包含两张图且焦点切到新图', async () => {
    await mountApp();
    const store = useGalleryRuntimesStore();
    const paragraph = document.querySelector('.mes_text p') as HTMLElement;

    const blob1 = new Blob(['img1'], { type: 'image/png' });
    await store.showGenerated(paragraph, { imageBlob: blob1, promptSnapshot: makeSnapshot() });
    await flushFrames();

    const focusAfterFirst = document.querySelectorAll('.cv-inline-favorite-img');
    expect(focusAfterFirst.length).toBe(1);
    expect(focusAfterFirst[0]!.getAttribute('src')).toBe(blobUrls.get(blob1));

    const blob2 = new Blob(['img2'], { type: 'image/png' });
    await store.showGenerated(paragraph, { imageBlob: blob2, promptSnapshot: makeSnapshot() });
    await flushFrames();

    const focusAfterSecond = document.querySelectorAll('.cv-inline-favorite-img');
    expect(focusAfterSecond.length).toBe(1);
    expect(focusAfterSecond[0]!.getAttribute('src')).toBe(blobUrls.get(blob2));

    const thumbs = document.querySelectorAll('.cv-inline-gallery-strip-item');
    expect(thumbs.length).toBe(2);
    const activeThumb = document.querySelector('.cv-inline-gallery-strip-item[data-p-active="true"]');
    expect(activeThumb?.querySelector('img')?.getAttribute('src')).toBe(blobUrls.get(blob2));

    // 点击旧图缩略图切回旧图
    (thumbs[1] as HTMLElement).click();
    await flushFrames();
    const focusAfterClick = document.querySelector('.cv-inline-favorite-img');
    expect(focusAfterClick?.getAttribute('src')).toBe(blobUrls.get(blob1));

    // 聊天 DOM 内没有任何 Vue 组件树痕迹（命令式零 Vue）
    expect(document.querySelector('.cv-render [data-v-app]')).toBeNull();
  });

  it('消息重渲染后再生成：新图应进入画廊且可切换', async () => {
    await mountApp();
    const store = useGalleryRuntimesStore();
    const paragraph = document.querySelector('.mes_text p') as HTMLElement;

    const blob1 = new Blob(['img1'], { type: 'image/png' });
    await store.showGenerated(paragraph, { imageBlob: blob1, promptSnapshot: makeSnapshot() });
    await flushFrames();
    expect(document.querySelectorAll('.cv-inline-favorite-img').length).toBe(1);

    rerenderMesText(0);
    eventSource.emit(event_types.MESSAGE_UPDATED, 0);
    await flushFrames();
    expect(document.querySelectorAll('.cv-inline-favorite-img').length).toBe(1);

    const blob2 = new Blob(['img2'], { type: 'image/png' });
    const rebuiltParagraph = document.querySelector('.mes_text p') as HTMLElement;
    await store.showGenerated(rebuiltParagraph, { imageBlob: blob2, promptSnapshot: makeSnapshot() });
    await flushFrames();

    const focusAfterSecond = document.querySelector('.cv-inline-favorite-img');
    expect(focusAfterSecond?.getAttribute('src')).toBe(blobUrls.get(blob2));

    const thumbs = document.querySelectorAll('.cv-inline-gallery-strip-item');
    expect(thumbs.length).toBe(2);
    (thumbs[1] as HTMLElement).click();
    await flushFrames();
    expect(document.querySelector('.cv-inline-favorite-img')?.getAttribute('src')).toBe(blobUrls.get(blob1));
  });

  it('生成后立即触发楼层重渲染（竞态）：新图仍应进入画廊且可切换', async () => {
    await mountApp();
    const store = useGalleryRuntimesStore();
    const paragraph = document.querySelector('.mes_text p') as HTMLElement;

    const blob1 = new Blob(['img1'], { type: 'image/png' });
    await store.showGenerated(paragraph, { imageBlob: blob1, promptSnapshot: makeSnapshot() });
    await flushFrames();

    const blob2 = new Blob(['img2'], { type: 'image/png' });
    await store.showGenerated(paragraph, { imageBlob: blob2, promptSnapshot: makeSnapshot() });
    eventSource.emit(event_types.MESSAGE_UPDATED, 0);
    await flushFrames(12);

    const focusAfterSecond = document.querySelector('.cv-inline-favorite-img');
    expect(focusAfterSecond?.getAttribute('src')).toBe(blobUrls.get(blob2));

    const thumbs = document.querySelectorAll('.cv-inline-gallery-strip-item');
    expect(thumbs.length).toBe(2);
    (thumbs[1] as HTMLElement).click();
    await flushFrames();
    expect(document.querySelector('.cv-inline-favorite-img')?.getAttribute('src')).toBe(blobUrls.get(blob1));
  });

  it('ST 整体重写楼层 DOM 后画廊 DOM 随之消亡（零残留）', async () => {
    await mountApp();
    const store = useGalleryRuntimesStore();
    const paragraph = document.querySelector('.mes_text p') as HTMLElement;

    const blob1 = new Blob(['img1'], { type: 'image/png' });
    await store.showGenerated(paragraph, { imageBlob: blob1, promptSnapshot: makeSnapshot() });
    await flushFrames();
    expect(document.querySelectorAll('.cv-inline-favorite-img').length).toBe(1);

    // ST 无通知整体重写 .mes_text —— 命令式 DOM 无组件树，无卸载崩溃
    rerenderMesText(0);
    expect(() => flushFrames(4)).not.toThrow();
    await flushFrames(4);

    // 画廊随容器一起消失
    expect(document.querySelectorAll('.cv-inline-favorite-img').length).toBe(0);
  });
});
