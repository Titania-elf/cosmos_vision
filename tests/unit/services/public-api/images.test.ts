import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readGeneratedImage } from '@/services/public-api/images';
import { pngBlob } from './fixtures';

const close = vi.fn();
beforeEach(() =>
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 128, height: 64, close })),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe('public generated images', () => {
  it('returns a real Blob and decoded dimensions, not the configured image size', async () => {
    const image = await readGeneratedImage(pngBlob(), new AbortController().signal, 42);
    expect(image).toMatchObject({ mimeType: 'image/png', width: 128, height: 64, seed: 42 });
    expect(image.blob).toBeInstanceOf(Blob);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['image/jpeg', [0xff, 0xd8, 0xff, 0xe0]],
    [
      'image/webp',
      [...Array.from('RIFF', c => c.charCodeAt(0)), 20, 0, 0, 0, ...Array.from('WEBP', c => c.charCodeAt(0))],
    ],
  ])('accepts %s with matching magic bytes and a successful decoder', async (mimeType, bytes) => {
    const image = await readGeneratedImage(
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      new AbortController().signal,
    );
    expect(image.mimeType).toBe(mimeType);
  });

  it.each([
    new Blob([], { type: 'image/png' }),
    new Blob(['<html>backend error</html>'], { type: 'image/png' }),
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' }),
    new Blob(['GIF89a'], { type: 'image/gif' }),
  ])('rejects empty files and unsupported or mislabeled content', async blob => {
    await expect(readGeneratedImage(blob, new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects corrupt images even when the magic bytes are valid', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('decoder failed'));
    await expect(readGeneratedImage(pngBlob(), new AbortController().signal)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('normalizes a generic MIME type after checking the actual bytes', async () => {
    const image = await readGeneratedImage(
      new Blob([pngBlob()], { type: 'application/octet-stream' }),
      new AbortController().signal,
    );
    expect(image.mimeType).toBe('image/png');
    expect(image.blob.type).toBe('image/png');
  });

  it('releases object URLs and handlers in the image-element fallback', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    class TestImage {
      naturalWidth = 32;
      naturalHeight = 16;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
      removeAttribute() {}
    }
    vi.stubGlobal('Image', TestImage);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const image = await readGeneratedImage(pngBlob(), new AbortController().signal);
    expect(image).toMatchObject({ width: 32, height: 16 });
    expect(revoke).toHaveBeenCalledTimes(1);
    revoke.mockRestore();
  });
});
