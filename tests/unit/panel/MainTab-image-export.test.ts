import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils';
import MainTab from '@/panel/tabs/MainTab.vue';
import {
  IMAGE_DOWNLOAD_OPTIONS_REQUEST_KEY,
  createDefaultInlineImageDownloadOptions,
  type InlineImageDownloadOptions,
} from '@/services/inline-image/download-options';
import type { ManagedImageItem } from '@/services/inline-image/managed-images';
import JSZipMock from '../../helpers/sillytavern-jszip-mock';

const mocks = vi.hoisted(() => ({
  loadImageBlob: vi.fn(),
  listFavorites: vi.fn(),
  listTemporaries: vi.fn(),
  requestOptions: vi.fn(),
  triggerBrowserDownload: vi.fn(),
}));

vi.mock('@/store/settings', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/services/inline-image/favorites-cache', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/inline-image/favorites-cache')>()),
  listInlineImageFavoriteMeta: mocks.listFavorites,
}));
vi.mock('@/services/inline-image/temporary-images', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/inline-image/temporary-images')>()),
  listAllTemporaryImageMeta: mocks.listTemporaries,
}));
vi.mock('@/services/inline-image/managed-images', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/inline-image/managed-images')>()),
  loadImageBlob: mocks.loadImageBlob,
}));
vi.mock('@/services/novelai/vibe-cache', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/novelai/vibe-cache')>()),
  listNovelAIVibeCacheItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/inline-image/image-download-transform', () => ({
  transformInlineImageForDownload: async (blob: Blob) => ({ blob, extension: 'png' }),
  downloadInlineImageBlob: vi.fn(),
  triggerBrowserDownload: mocks.triggerBrowserDownload,
}));

let wrapper: VueWrapper;
async function mountTab() {
  wrapper = shallowMount(MainTab, {
    props: { subTab: 'data' },
    global: { provide: { [IMAGE_DOWNLOAD_OPTIONS_REQUEST_KEY]: mocks.requestOptions } },
  });
  await flushPromises();
  return wrapper.findComponent({ name: 'InlineFavoriteDataPanel' });
}

beforeEach(() => {
  const meta = { characterKey: 'Alice', chatId: 'chat-1', slotId: 'slot-1', promptSnapshot: {} };
  mocks.listFavorites.mockResolvedValue([{ ...meta, id: 1, createdAt: 1, filePath: '/favorite.png' }]);
  mocks.listTemporaries.mockResolvedValue([{ ...meta, id: '2', createdAt: 2 }]);
  mocks.requestOptions.mockResolvedValue(createDefaultInlineImageDownloadOptions());
  mocks.loadImageBlob.mockImplementation(async (item: ManagedImageItem) => new Blob([item.key]));
});
afterEach(() => wrapper?.unmount());

describe('图片批量导出流程', () => {
  it('少量收藏和临时图片逐张下载，忽略重复及失效选择后判断打包数量', async () => {
    const panel = await mountTab();
    panel.vm.$emit('export-items', [...Array(31).fill('favorite:1'), 'temporary:2', 'missing']);
    await flushPromises();

    expect(mocks.loadImageBlob).toHaveBeenCalledTimes(2);
    const downloads = mocks.triggerBrowserDownload.mock.calls;
    expect(downloads).toHaveLength(2);
    expect(downloads.every(([, name]) => name.endsWith('.png'))).toBe(true);
    expect(await Promise.all(downloads.map(([blob]) => blob.text()))).toEqual(['temporary:2', 'favorite:1']);
    expect(toastr.success).toHaveBeenCalledWith('已导出 2 张图片');
    expect(panel.props('busy')).toBe(false);
    expect(panel.props('exportProgress')).toBeNull();
  });

  it.each([30, 31])('选择 %i 张收藏与临时图片时，按总数决定逐张下载或统一打包', async count => {
    const meta = { characterKey: 'Alice', chatId: 'chat-1', slotId: 'slot-1', promptSnapshot: {} };
    mocks.listFavorites.mockResolvedValue(
      Array.from({ length: count - 1 }, (_, index) => ({
        ...meta,
        id: index + 1,
        createdAt: index + 1,
        filePath: `/favorite-${index}.png`,
      })),
    );
    const panel = await mountTab();
    panel.vm.$emit('export-items', [
      ...Array.from({ length: count - 1 }, (_, index) => `favorite:${index + 1}`),
      'temporary:2',
    ]);
    await flushPromises();
    expect(mocks.loadImageBlob).toHaveBeenCalledTimes(count);
    const downloads = mocks.triggerBrowserDownload.mock.calls;
    if (count === 30) {
      expect(downloads).toHaveLength(30);
      expect(downloads.every(([, name]) => name.endsWith('.png'))).toBe(true);
    } else {
      expect(downloads).toHaveLength(1);
      expect(downloads[0][1]).toMatch(/^cosmos-vision-images-.*\.zip$/);
      const zip = await JSZipMock.loadAsync(downloads[0][0]);
      const contents = await Promise.all(Object.values(zip.files).map(entry => entry.async('string')));
      expect(contents).toHaveLength(31);
      expect(contents).toContain('favorite:1');
      expect(contents).toContain('temporary:2');
    }
  });

  it('选择格式期间阻止重复导出，取消后解除忙碌状态且不读取图片', async () => {
    let resolveOptions!: (options: InlineImageDownloadOptions | null) => void;
    mocks.requestOptions.mockReturnValue(
      new Promise(resolve => {
        resolveOptions = resolve;
      }),
    );
    const panel = await mountTab();
    panel.vm.$emit('export-items', ['favorite:1']);
    panel.vm.$emit('export-items', ['temporary:2']);
    await flushPromises();
    expect(mocks.requestOptions).toHaveBeenCalledTimes(1);
    expect(panel.props('busy')).toBe(true);

    resolveOptions(null);
    await flushPromises();
    expect(mocks.loadImageBlob).not.toHaveBeenCalled();
    expect(mocks.triggerBrowserDownload).not.toHaveBeenCalled();
    expect(panel.props('busy')).toBe(false);
  });

  it('部分图片失效时导出剩余图片并提示数量，完成后清理进度', async () => {
    mocks.loadImageBlob.mockImplementation(async (item: ManagedImageItem) => {
      if (item.kind === 'temporary') throw new Error('missing');
      return new Blob([item.key]);
    });
    const panel = await mountTab();
    panel.vm.$emit('export-items', ['favorite:1', 'temporary:2']);
    await flushPromises();
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    expect(toastr.warning).toHaveBeenCalledWith('已导出 1 张图片，1 张加载或转换失败，已跳过');
    expect(panel.props('busy')).toBe(false);
    expect(panel.props('exportProgress')).toBeNull();
  });
});
