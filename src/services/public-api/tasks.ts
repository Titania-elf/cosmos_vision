import { createRequestTimeoutController } from '@/services/request-timeout';
import { PublicApiError, throwIfAborted, toPublicApiError } from './errors';
import type { RequestControl } from './types';
import { validateControl } from './validation';

type ProgressStage = Parameters<NonNullable<RequestControl['onProgress']>>[0]['stage'];
export interface PublicTask {
  requestId: string;
  signal: AbortSignal;
  progress(stage: ProgressStage): void;
}

const PROGRESS_MESSAGES: Record<ProgressStage, string> = {
  queued: '请求已接收。',
  analyzing: '正在选择画面并准备提示词。',
  generating: '正在生成图片。',
  downloading: '正在读取并校验图片。',
};

/** 每页最多保留 256 个已接受的请求 ID；忙时明确拒绝，不覆盖运行中的任务。 */
export class PublicTaskRunner {
  private readonly requestIds = new Set<string>();
  private busy = false;

  async run<T>(
    input: RequestControl,
    prepare: () => { timeoutSeconds: number; execute: (task: PublicTask) => Promise<T> },
  ): Promise<T> {
    const control = validateControl(input);
    throwIfAborted(control.signal);
    if (this.requestIds.has(control.requestId))
      throw new PublicApiError('DUPLICATE_REQUEST', '此请求 ID 已使用，请为新任务生成新的 requestId。');
    if (this.busy) throw new PublicApiError('BUSY', '公开接口正在处理另一个请求，请稍后重试。');
    this.busy = true;
    this.requestIds.add(control.requestId);
    if (this.requestIds.size > 256) this.requestIds.delete(this.requestIds.values().next().value!);
    try {
      // 在任何 await 或进度回调前完成参数校验与配置快照。
      const operation = prepare();
      const timeout = createRequestTimeoutController(control.signal, operation.timeoutSeconds);
      let finished = false;
      const progress = (stage: ProgressStage) => {
        if (finished || timeout.signal.aborted) return;
        try {
          void Promise.resolve(
            control.onProgress?.({ requestId: control.requestId, stage, message: PROGRESS_MESSAGES[stage] }),
          ).catch(() => {});
        } catch {
          /* 调用方回调不能改变请求的提交次数或结果。 */
        }
      };
      try {
        progress('queued');
        throwIfAborted(timeout.signal);
        const result = await waitForTask(
          operation.execute({ requestId: control.requestId, signal: timeout.signal, progress }),
          timeout.signal,
        );
        throwIfAborted(timeout.signal);
        return result;
      } catch (error) {
        if (timeout.isTimedOut()) throw new PublicApiError('TIMEOUT', '本次请求超时，已停止等待结果。');
        throwIfAborted(timeout.signal);
        throw error;
      } finally {
        finished = true;
        timeout.dispose();
      }
    } catch (error) {
      throw toPublicApiError(error);
    } finally {
      this.busy = false;
    }
  }
}

/** 即使服务端不能中断，也立即停止等待，并消费迟到的成功/失败。 */
export async function waitForTask<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new PublicApiError('ABORTED', '本次请求已取消。'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
