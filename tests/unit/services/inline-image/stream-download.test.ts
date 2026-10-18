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

  it.each([1, 2, 30])('%i 张图片逐张下载，保留转换格式并使用不同文件名', async count => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const items = Array.from({ length: count }, (_, index) => streamItem(async () => new Blob([String(index)])));
    mocks.transformInlineImageForDownload.mockImplementation(async (blob: Blob) => ({ blob, extension: 'jpg' }));

    const result = await downloadInlineImageStreamItems(items, downloadOptions);

    expect(result).toEqual({ succeededCount: count, failedCount: 0 });
    const downloads = mocks.triggerBrowserDownload.mock.calls;
    expect(downloads).toHaveLength(count);
    expect(new Set(downloads.map(([, name]) => name)).size).toBe(count);
    expect(downloads.every(([, name]) => name.endsWith('.jpg'))).toBe(true);
    expect(await Promise.all(downloads.map(([blob]) => blob.text()))).toEqual(items.map((_, index) => String(index)));
  });

  it('ZIP 部分失败跳过并计数，仍导出成功项', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const items = Array.from({ length: 31 }, (_, index) =>
      streamItem(async () => {
        if (index === 1) throw new Error('missing');
        return new Blob([String(index)]);
      }),
    );

    const result = await downloadInlineImageStreamItems(items, downloadOptions, 'archive.zip');

    expect(result).toEqual({ succeededCount: 30, failedCount: 1 });
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    const zip = await JSZipMock.loadAsync(mocks.triggerBrowserDownload.mock.calls[0][0]);
    expect(Object.values(zip.files)).toHaveLength(30);
  });

  it.each([2, 31])('%i 张图片全部失败时抛错且不触发下载', async count => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const items = Array.from({ length: count }, () => streamItem(() => Promise.reject(new Error('missing'))));

    await expect(downloadInlineImageStreamItems(items, downloadOptions)).rejects.toThrow('没有可成功导出的图片');
    expect(mocks.triggerBrowserDownload).not.toHaveBeenCalled();
  });

  it('31 张图片生成一个 ZIP，内容和扩展名跟随转换结果，并报告打包进度', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const source = new Blob(['source']);
    mocks.transformInlineImageForDownload.mockResolvedValue({ blob: new Blob(['converted']), extension: 'jpg' });
    const onProgress = vi.fn();
    const result = await downloadInlineImageStreamItems(
      Array.from({ length: 31 }, () => streamItem(() => Promise.resolve(source))),
      downloadOptions,
      'export.zip',
      { onProgress },
    );

    expect(result).toEqual({ succeededCount: 31, failedCount: 0 });
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    expect(mocks.transformInlineImageForDownload).toHaveBeenCalledWith(source, downloadOptions);
    const [blob, name] = mocks.triggerBrowserDownload.mock.calls[0];
    expect(name).toBe('export.zip');
    const zip = await JSZipMock.loadAsync(blob);
    const entries = Object.values(zip.files);
    expect(entries).toHaveLength(31);
    expect(entries.every(entry => entry.name.endsWith('.jpg'))).toBe(true);
    expect(await Promise.all(entries.map(entry => entry.async('string')))).toEqual(Array(31).fill('converted'));
    expect(onProgress).toHaveBeenLastCalledWith({ phase: 'archive', completed: 31, total: 31 });
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
    ]);
    const downloads = mocks.triggerBrowserDownload.mock.calls;
    expect(downloads).toHaveLength(2);
    expect(downloads[0][1]).not.toBe(downloads[1][1]);
    expect(await Promise.all(downloads.map(([blob]) => blob.text()))).toEqual(['first', 'third']);
  });

  it('逐张下载时转换失败跳过，后续图片继续下载', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    mocks.transformInlineImageForDownload.mockRejectedValueOnce(new Error('conversion failed'));
    const result = await downloadInlineImageStreamItems(
      [streamItem(async () => new Blob(['bad'])), streamItem(async () => new Blob(['good']))],
      downloadOptions,
    );
    expect(result).toEqual({ succeededCount: 1, failedCount: 1 });
    expect(mocks.triggerBrowserDownload).toHaveBeenCalledTimes(1);
    expect(await mocks.triggerBrowserDownload.mock.calls[0][0].text()).toBe('good');
  });

  it('ZIP 打包失败向调用方抛错，不触发下载', async () => {
    const { downloadInlineImageStreamItems } = await importDownloadModule();
    const generate = vi.spyOn(JSZipMock.prototype, 'generateAsync').mockRejectedValueOnce(new Error('zip failed'));
    try {
      await expect(
        downloadInlineImageStreamItems(
          Array.from({ length: 31 }, () => streamItem(() => Promise.resolve(new Blob(['a'])))),
          downloadOptions,
          'export.zip',
        ),
      ).rejects.toThrow('zip failed');
      expect(mocks.triggerBrowserDownload).not.toHaveBeenCalled();
    } finally {
      generate.mockRestore();
    }
  });
});
