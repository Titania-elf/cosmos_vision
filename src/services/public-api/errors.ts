export type PublicApiErrorCode =
  | 'NOT_READY'
  | 'DISABLED'
  | 'INVALID_REQUEST'
  | 'TEXT_TOO_LONG'
  | 'UNSUPPORTED_MODE'
  | 'UNSUPPORTED_CONTEXT'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'LLM_NOT_CONFIGURED'
  | 'CONFIG_CHANGED'
  | 'NO_SCENE'
  | 'INVALID_RESPONSE'
  | 'BUSY'
  | 'DUPLICATE_REQUEST'
  | 'TIMEOUT'
  | 'GENERATION_FAILED'
  | 'ABORTED';

/** 只使用本地文案，不能将远端错误、请求体或凭据作为 message/cause 透传。 */
export class PublicApiError extends Error {
  constructor(
    public readonly code: PublicApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code === 'ABORTED' ? 'AbortError' : 'CosmosVisionError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PublicApiError('ABORTED', '本次请求已取消。');
}

export function toPublicApiError(error: unknown): PublicApiError {
  if (error instanceof PublicApiError) return error;
  return new PublicApiError('GENERATION_FAILED', '本次请求失败，请检查服务连接和配置后使用新的请求 ID 重试。');
}
