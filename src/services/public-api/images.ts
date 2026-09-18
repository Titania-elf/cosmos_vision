import { PublicApiError, throwIfAborted } from './errors';
import type { GeneratedImage } from './types';

function invalidImage(): PublicApiError {
  return new PublicApiError('INVALID_RESPONSE', '图像服务未返回有效的 PNG、JPEG 或 WebP 图片。');
}

export async function readGeneratedImage(
  blob: Blob,
  signal: AbortSignal,
  seed?: number | string,
): Promise<GeneratedImage> {
  throwIfAborted(signal);
  if (!(blob instanceof Blob) || !blob.size) throw invalidImage();
  const bytes = new Uint8Array(await readHeader(blob.slice(0, 16), signal));
  const mimeType = detectMimeType(bytes);
  if (!mimeType || (blob.type && blob.type !== 'application/octet-stream' && blob.type !== mimeType))
    throw invalidImage();
  const normalizedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  const dimensions = await readDimensions(normalizedBlob, signal);
  throwIfAborted(signal);
  if (
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  )
    throw invalidImage();
  return {
    blob: normalizedBlob,
    mimeType,
    ...dimensions,
    ...((typeof seed === 'number' && Number.isFinite(seed)) || typeof seed === 'string' ? { seed } : {}),
  };
}

function detectMimeType(bytes: Uint8Array): GeneratedImage['mimeType'] | undefined {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
    return 'image/webp';
  return undefined;
}

async function readHeader(blob: Blob, signal: AbortSignal): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      reader.abort();
      cleanup();
      reject(new PublicApiError('ABORTED', '本次请求已取消。'));
    };
    reader.onload = () => {
      cleanup();
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      cleanup();
      reject(invalidImage());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    reader.readAsArrayBuffer(blob);
  });
}

async function readDimensions(blob: Blob, signal: AbortSignal): Promise<{ width: number; height: number }> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      throw invalidImage();
    }
    try {
      throwIfAborted(signal);
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      image.removeAttribute('src');
      signal.removeEventListener('abort', abort);
      URL.revokeObjectURL(url);
    };
    const abort = () => {
      cleanup();
      reject(new PublicApiError('ABORTED', '本次请求已取消。'));
    };
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      cleanup();
      resolve(size);
    };
    image.onerror = () => {
      cleanup();
      reject(invalidImage());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    image.src = url;
  });
}
