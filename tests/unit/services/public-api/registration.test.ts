import { describe, expect, it, vi } from 'vitest';
import { registerCosmosVisionPublicApi } from '@/services/public-api';
import type { CosmosVisionPublicApi } from '@/services/public-api/types';
import { makeSettings } from './fixtures';

describe('public API registration', () => {
  it('registers once, preserves future members and becomes ready without mounting Vue or chat DOM', async () => {
    const target = new EventTarget() as Window;
    target.CosmosVision = { futureMember: 'preserved' } as unknown as CosmosVisionPublicApi;
    const original = target.CosmosVision;
    const ready = vi.fn();
    const changed = vi.fn();
    target.addEventListener('cosmos-vision:ready', ready);
    target.addEventListener('cosmos-vision:capabilities-changed', changed);
    const first = registerCosmosVisionPublicApi(target);
    const second = registerCosmosVisionPublicApi(target);
    expect(first).toBe(second);
    expect(first.api).toBe(original);
    expect(first.api).toHaveProperty('futureMember', 'preserved');
    expect(ready).toHaveBeenCalledTimes(1);
    expect(await first.api.getCapabilities()).toMatchObject({ apiVersion: '1.0', ready: false });
    expect(first.initialize(makeSettings)).toBe(true);
    expect(second.initialize(() => undefined)).toBe(false);
    expect(await target.CosmosVision.getCapabilities()).toMatchObject({ ready: true, enabled: true });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0]![0] as CustomEvent).detail).toBeNull();
  });
});
