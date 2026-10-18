import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadableImageStreamItem } from '@/services/inline-image/favorites-download';
import type { InlineImageDownloadOptions } from '@/services/inline-image/download-options';
import JSZipMock from '../../../helpers/sillytavern-jszip-mock';

const mocks = vi.hoisted(() => ({
  transformInlineImageForDownload: vi.fn(),
  downloadInlineImageBlob: vi.fn(),
  triggerBrowserDownload: vi.fn(),
}));

vi.mock('@/services/inline-image/image-download-transform', () => ({
  transformInlineImageForDownload: mocks.transformInlineImageForDownload,
  downloadInlineImageBlob: mocks.downloadInlineImageBlob,
  triggerBrowserDownload: mocks.triggerBrowserDownload,
}));

const downloadOptions = {} as InlineImageDownloadOptions;

/** 构造流式下载项 */
function streamItem(loadBlob: () => Promise<Blob>): DownloadableImageStreamItem {
  return { loadBlob, createdAt: 1 };
}

/** 动态加载被测模块（需先注入 JSZip 全局替身） */
async function importDownloadModule() {
  const { default: JSZipMock } = await import('@sillytavern/lib/jszip.min');
  vi.stubGlobal('JSZip', JSZipMock);
  return import('@/services/inline-image/favorites-download');
}

describe('downloadInlineImageStreamItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transformInlineImageForDownload.mockImplementation(async (blob: Blob) => ({ blob, extension: 'png' }));
  });

  it('空列表直接返回零计数', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const result = await downloadInlineImageStreamItems([], downloadOptions);
    expect(result).toEqual({ succeededCount: 0, failedCount: 0 });
    expect(mocks.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it('单张成功直接下载并返回成功计数', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const blob = new Blob(['single']);

    const result = await downloadInlineImageStreamItems([streamItem(() => Promise.resolve(blob))], downloadOptions);

    expect(result).toEqual({ succeededCount: 1, failedCount: 0 });
    expect(mocks.downloadInlineImageBlob).toHaveBeenCalledWith(blob, expect.any(String), downloadOptions);
  });

  it('ZIP 部分失败跳过并计数，仍导出成功项', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const items = [
      streamItem(() => Promise.resolve(new Blob(['a']))),
      streamItem(() => Promise.reject(new Error('missing'))),
      streamItem(() => Promise.resolve(new Blob(['c']))),
    ];

    const result = await downloadInlineImageStreamItems(items, downloadOptions, 'archive.zip');

    expect(result).toEqual({ succeededCount: 2, failedCount: 1 });
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledTimes(1);
  });

  it('全部失败时抛错且不触发下载', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const items = [
      streamItem(() => Promise.reject(new Error('missing-a'))),
      streamItem(() => Promise.reject(new Error('missing-b'))),
    ];

    await expect(downloadInlineImageStreamItems(items, downloadOptions)).rejects.toThrow('没有可成功导出的图片');
    expect(mocks.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it('批量导出单张仍生成 ZIP，文件内容和扩展名跟随转换结果', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const source = new Blob(['source']);
    mocks.transformInlineImageForDownload.mockResolvedValue({ blob: new Blob(['converted']), extension: 'jpg' });
    const result = await downloadInlineImageStreamItems(
      [streamItem(() => Promise.resolve(source))],
      downloadOptions,
      'export.zip',
      { forceZip: true },
    );

    expect(result).toEqual({ succeededCount: 1, failedCount: 0 });
    expect(mocks.downloadInlineImageBlob).not.toHaveBeenCalled();
    expect(mocks.transformInlineImageForDownload).toHaveBeenCalledWith(source, downloadOptions);
    const [blob, name] = mocks.triggerBrowserDownload.mock.calls[0];
    expect(name).toBe('export.zip');
    const zip = await JSZipMock.loadAsync(blob);
    const entries = Object.values(zip.files);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toMatch(/\.jpg$/);
    expect(await entries[0].async('string')).toBe('converted');
  });

  it('逐张加载并报告包括失败项在内的进度，同时间戳图片不会互相覆盖', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const onProgress = vi.fn();
    let resolveFirst!: (blob: Blob) => void;
    const first = new Promise<Blob>(resolve => {
      resolveFirst = resolve;
    });
    const loadSecond = vi.fn().mockRejectedValue(new Error('missing'));
    const items = [
      streamItem(() => first),
      streamItem(loadSecond),
      streamItem(() => Promise.resolve(new Blob(['third']))),
    ];

    const pending = downloadInlineImageStreamItems(items, downloadOptions, 'export.zip', {
      forceZip: true,
      onProgress,
    });
    expect(loadSecond).not.toHaveBeenCalled();
    resolveFirst(new Blob(['first']));
    await expect(pending).resolves.toEqual({ succeededCount: 2, failedCount: 1 });
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { phase: 'images', completed: 0, total: 3 },
      { phase: 'images', completed: 1, total: 3 },
      { phase: 'images', completed: 2, total: 3 },
      { phase: 'images', completed: 3, total: 3 },
      { phase: 'archive', completed: 3, total: 3 },
    ]);
    const zip = await JSZipMock.loadAsync(mocks.triggerBrowserDownload.mock.calls[0][0]);
    const entries = Object.values(zip.files);
    expect(entries).toHaveLength(2);
    expect(await Promise.all(entries.map(entry => entry.async('string')))).toEqual(['first', 'third']);
  });

  it('ZIP 打包失败向调用方抛错，不触发下载', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const generate = vi.spyOn(JSZipMock.prototype, 'generateAsync').mockRejectedValueOnce(new Error('zip failed'));
    try {
      await expect(
        downloadInlineImageStreamItems(
          [streamItem(() => Promise.resolve(new Blob(['a'])))],
          downloadOptions,
          'export.zip',
          { forceZip: true },
        ),
      ).rejects.toThrow('zip failed');
      expect(mocks.triggerBrowserDownload).not.toHaveBeenCalled();
    } finally {
      generate.mockRestore();
    }
  });
});
