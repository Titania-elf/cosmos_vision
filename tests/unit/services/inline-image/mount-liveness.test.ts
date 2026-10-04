import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectDetachedMountFloors,
  createMountLivenessObserver,
  type MountLivenessRuntime,
} from '@/services/inline-image/mount-liveness';

/** 造一个带 .mes 的聊天容器 */
function mountChat(): HTMLElement {
  document.body.innerHTML = '<div id="chat"></div>';
  return document.querySelector('#chat') as HTMLElement;
}

/** 在楼层里放一个挂载容器 */
function addFloor(chat: HTMLElement, messageId: number): HTMLElement {
  const mes = document.createElement('div');
  mes.className = 'mes';
  mes.setAttribute('mesid', String(messageId));
  const container = document.createElement('div');
  container.className = 'cv-render';
  mes.append(container);
  chat.append(mes);
  return container;
}

/** 按楼层号读取 #chat 下的 .mes */
function findMes(messageId: number): Element | null {
  return document.querySelector(`#chat > .mes[mesid="${messageId}"]`);
}

/** 推进一拍微任务，让 jsdom 投递 MutationObserver 回调 */
async function flushMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('inline-image mount-liveness', () => {
  describe('collectDetachedMountFloors', () => {
    it('reports nothing while every mount is connected', () => {
      const chat = mountChat();
      const runtimes: MountLivenessRuntime[] = [{ message_id: 1, mounts: [{ element: addFloor(chat, 1) }] }];
      expect(collectDetachedMountFloors(runtimes, findMes)).toEqual([]);
    });

    it('reports the floor whose container was dropped by an innerHTML rewrite', () => {
      const chat = mountChat();
      const container = addFloor(chat, 1);
      const runtimes: MountLivenessRuntime[] = [{ message_id: 1, mounts: [{ element: container }] }];
      // 模拟别的扩展整块重写 .mes_text：容器连同旧节点一起被丢掉
      (container.parentElement as HTMLElement).innerHTML = '<p>重写后的正文</p>';
      expect(collectDetachedMountFloors(runtimes, findMes)).toEqual([1]);
    });

    it('ignores floors that are no longer in the chat DOM', () => {
      const chat = mountChat();
      const container = addFloor(chat, 1);
      const runtimes: MountLivenessRuntime[] = [{ message_id: 1, mounts: [{ element: container }] }];
      container.remove();
      (document.querySelector('#chat > .mes[mesid="1"]') as HTMLElement).remove();
      expect(collectDetachedMountFloors(runtimes, findMes)).toEqual([]);
    });

    it('skips floors without mounts and keeps runtime order', () => {
      const chat = mountChat();
      const first = addFloor(chat, 1);
      const second = addFloor(chat, 3);
      const runtimes: MountLivenessRuntime[] = [
        { message_id: 1, mounts: [{ element: first }] },
        { message_id: 2, mounts: [] },
        { message_id: 3, mounts: [{ element: second }] },
      ];
      second.remove();
      expect(collectDetachedMountFloors(runtimes, findMes)).toEqual([3]);
    });
  });

  describe('createMountLivenessObserver', () => {
    it('reports detached floors after the settle window', async () => {
      vi.useFakeTimers();
      const chat = mountChat();
      const missing = addFloor(chat, 5);
      const onDetached = vi.fn();
      const observer = createMountLivenessObserver({
        resolveRoot: () => document.querySelector('#chat'),
        collectDetachedFloors: () => collectDetachedMountFloors([{ message_id: 5, mounts: [{ element: missing }] }], findMes),
        onDetached,
        settleMs: 100,
      });
      missing.remove();

      expect(onDetached).not.toHaveBeenCalled();
      await flushMutation();
      await vi.advanceTimersByTimeAsync(150);
      expect(onDetached).toHaveBeenCalledTimes(1);
      expect(onDetached).toHaveBeenCalledWith([5]);
      observer.disconnect();
    });

    it('coalesces a burst of mutations into one report', async () => {
      vi.useFakeTimers();
      const chat = mountChat();
      const onDetached = vi.fn();
      const observer = createMountLivenessObserver({
        resolveRoot: () => document.querySelector('#chat'),
        collectDetachedFloors: () => [7],
        onDetached,
        settleMs: 100,
      });

      for (let i = 0; i < 5; i++) chat.append(document.createElement('div'));
      await flushMutation();
      await vi.advanceTimersByTimeAsync(150);
      expect(onDetached).toHaveBeenCalledTimes(1);
      observer.disconnect();
    });

    it('stops reporting after disconnect', async () => {
      vi.useFakeTimers();
      const chat = mountChat();
      const onDetached = vi.fn();
      const observer = createMountLivenessObserver({
        resolveRoot: () => document.querySelector('#chat'),
        collectDetachedFloors: () => [7],
        onDetached,
        settleMs: 100,
      });
      observer.disconnect();

      chat.append(document.createElement('div'));
      await flushMutation();
      await vi.advanceTimersByTimeAsync(150);
      expect(onDetached).not.toHaveBeenCalled();
    });

    it('falls back to document.body when the chat root is missing', async () => {
      vi.useFakeTimers();
      document.body.innerHTML = '';
      const onDetached = vi.fn();
      const observer = createMountLivenessObserver({
        resolveRoot: () => null,
        collectDetachedFloors: () => [9],
        onDetached,
        settleMs: 100,
      });

      document.body.append(document.createElement('div'));
      await flushMutation();
      await vi.advanceTimersByTimeAsync(150);
      expect(onDetached).toHaveBeenCalledWith([9]);
      observer.disconnect();
    });
  });
});
