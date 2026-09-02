import { describe, expect, it } from 'vitest';
import type { ComfyUIResolutionCombo } from '@/constants/comfyui';
import type { ComfyUIWorkflow } from '@/services/comfyui/types';
import {
  addResolutionCombo,
  applyResolutionToTarget,
  createResolutionComboId,
  listResolutionTargets,
  MAX_RESOLUTION_COMBOS,
  readNodeResolution,
  removeResolutionCombo,
  sortResolutionCombos,
  updateResolutionCombo,
} from '@/services/comfyui/resolution-combos';

/** 构造组合 */
function buildCombo(overrides: Partial<ComfyUIResolutionCombo> = {}): ComfyUIResolutionCombo {
  return {
    id: createResolutionComboId(),
    name: '人物立绘',
    width: 832,
    height: 1216,
    ...overrides,
  };
}

/** 构造最小工作流：单 EmptyLatentImage 节点 */
function buildWorkflow(width: number, height: number): ComfyUIWorkflow {
  return {
    latent: {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
      _meta: { title: 'Latent' },
    },
  } as unknown as ComfyUIWorkflow;
}

describe('sortResolutionCombos', () => {
  it('返回按名称排序的新数组，不修改原数组', () => {
    const combos = [
      buildCombo({ name: '电影场景' }),
      buildCombo({ name: '人物立绘' }),
      buildCombo({ name: 'Avatar' }),
    ];
    const sorted = sortResolutionCombos(combos);
    // 排序结果应与 localeCompare 一致且为稳定全序
    const expected = ['Avatar', '人物立绘', '电影场景'].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
    expect(sorted.map(combo => combo.name)).toEqual(expected);
    // 原数组顺序不变
    expect(combos.map(combo => combo.name)).toEqual(['电影场景', '人物立绘', 'Avatar']);
  });

  it('名称相同时按尺寸稳定排序', () => {
    const combos = [
      buildCombo({ name: '同尺寸组', width: 1024, height: 1024 }),
      buildCombo({ name: '同尺寸组', width: 832, height: 1216 }),
    ];
    const sorted = sortResolutionCombos(combos);
    expect(sorted[0]!.width).toBe(832);
    expect(sorted[1]!.width).toBe(1024);
  });
});

describe('addResolutionCombo', () => {
  it('追加新组合', () => {
    const combos = [buildCombo()];
    const next = addResolutionCombo(combos, buildCombo({ name: '电影场景', width: 1920, height: 1088 }));
    expect(next).toHaveLength(2);
  });

  it('同名同尺寸去重', () => {
    const combo = buildCombo();
    const next = addResolutionCombo([combo], buildCombo({ id: combo.id }));
    expect(next).toHaveLength(1);
  });

  it('达到上限抛错', () => {
    const combos = Array.from({ length: MAX_RESOLUTION_COMBOS }, (_, index) =>
      buildCombo({ name: `组合${index}`, width: 512 + index, height: 512 }),
    );
    expect(() => addResolutionCombo(combos, buildCombo({ name: '超额', width: 999, height: 999 }))).toThrow(
      `最多收藏 ${MAX_RESOLUTION_COMBOS} 组分辨率`,
    );
  });
});

describe('updateResolutionCombo / removeResolutionCombo', () => {
  it('重命名目标组合，其余不动', () => {
    const a = buildCombo({ name: 'A' });
    const b = buildCombo({ name: 'B' });
    const next = updateResolutionCombo([a, b], a.id, { name: 'A2' });
    expect(next.find(combo => combo.id === a.id)?.name).toBe('A2');
    expect(next.find(combo => combo.id === b.id)?.name).toBe('B');
  });

  it('删除目标组合', () => {
    const a = buildCombo({ name: 'A' });
    const b = buildCombo({ name: 'B' });
    const next = removeResolutionCombo([a, b], a.id);
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe(b.id);
  });
});

describe('readNodeResolution / applyResolutionToTarget', () => {
  it('读取可写 width/height 节点尺寸', () => {
    expect(readNodeResolution(buildWorkflow(832, 1216), 'latent')).toEqual({ width: 832, height: 1216 });
  });

  it('节点不存在返回 null', () => {
    expect(readNodeResolution(buildWorkflow(832, 1216), 'missing')).toBeNull();
  });

  it('width 为连线引用时返回 null', () => {
    const workflow = {
      latent: {
        class_type: 'EmptyLatentImage',
        inputs: { width: ['primitive', 0], height: 1216, batch_size: 1 },
      },
    } as unknown as ComfyUIWorkflow;
    expect(readNodeResolution(workflow, 'latent')).toBeNull();
  });

  it('应用组合就地写入直连目标的 width/height', () => {
    const workflow = buildWorkflow(512, 512);
    const [target] = listResolutionTargets(workflow);
    expect(target).toBeTruthy();
    const ok = applyResolutionToTarget(workflow, target!, { width: 1216, height: 832 });
    expect(ok).toBe(true);
    expect(workflow.latent!.inputs.width).toBe(1216);
    expect(workflow.latent!.inputs.height).toBe(832);
  });

  it('写入点当前值非数字时返回 false', () => {
    const workflow = buildWorkflow(512, 512);
    const [target] = listResolutionTargets(workflow);
    // 篡改写入点后再应用应失败
    workflow.latent!.inputs.width = ['other', 0];
    expect(applyResolutionToTarget(workflow, target!, { width: 1, height: 1 })).toBe(false);
  });
});

describe('listResolutionTargets', () => {
  it('直连场景：扫描出数字 width/height 节点', () => {
    const workflow = {
      '5': { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216 }, _meta: { title: '空Latent图像' } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'CV' } },
      '12': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024 } },
    } as unknown as ComfyUIWorkflow;
    const targets = listResolutionTargets(workflow);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ nodeId: '5', title: '空Latent图像', width: 832, height: 1216 });
    // 无 _meta.title 时回退 class_type
    expect(targets[1]).toMatchObject({ nodeId: '12', title: 'EmptySD3LatentImage' });
  });

  it('连线场景：沿连线追到 Primitive 节点的 value 输入', () => {
    const workflow = {
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: ['17', 0], height: ['18', 0], batch_size: 1 },
        _meta: { title: '空Latent图像' },
      },
      '17': { class_type: 'PrimitiveInt', inputs: { value: 832 }, _meta: { title: 'width' } },
      '18': { class_type: 'PrimitiveInt', inputs: { value: 1216 }, _meta: { title: 'height' } },
    } as unknown as ComfyUIWorkflow;
    const targets = listResolutionTargets(workflow);
    expect(targets).toHaveLength(1);
    const target = targets[0]!;
    // 定位展示用消费节点，写入点指向 Primitive 的 value
    expect(target.nodeId).toBe('5');
    expect(target.title).toBe('空Latent图像');
    expect(target.widthPoint).toEqual({ nodeId: '17', inputName: 'value' });
    expect(target.heightPoint).toEqual({ nodeId: '18', inputName: 'value' });
    expect(target.width).toBe(832);
    expect(target.height).toBe(1216);
    expect(target.detail).toBe('#17 value · #18 value');

    // 应用写入 Primitive 的 value，而非消费节点
    expect(applyResolutionToTarget(workflow, target, { width: 1024, height: 1024 })).toBe(true);
    expect((workflow as any)['17'].inputs.value).toBe(1024);
    expect((workflow as any)['18'].inputs.value).toBe(1024);
    // 消费节点的连线引用保持不变
    expect((workflow as any)['5'].inputs.width).toEqual(['17', 0]);
  });

  it('来源节点含多个数字输入（无法定位 value）时跳过', () => {
    const workflow = {
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['18', 0] } },
      '17': { class_type: 'KSampler', inputs: { seed: 1, steps: 30, cfg: 5 } },
      '18': { class_type: 'PrimitiveInt', inputs: { value: 1216 } },
    } as unknown as ComfyUIWorkflow;
    expect(listResolutionTargets(workflow)).toHaveLength(0);
  });

  it('上游来源节点缺失时跳过', () => {
    const workflow = {
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['99', 0], height: ['18', 0] } },
      '18': { class_type: 'PrimitiveInt', inputs: { value: 1216 } },
    } as unknown as ComfyUIWorkflow;
    expect(listResolutionTargets(workflow)).toHaveLength(0);
  });

  it('两个消费节点共享同一对 Primitive 时按写入点去重', () => {
    const workflow = {
      '5': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['18', 0] } },
      '6': { class_type: 'EmptyLatentImage', inputs: { width: ['17', 0], height: ['18', 0] } },
      '17': { class_type: 'PrimitiveInt', inputs: { value: 832 } },
      '18': { class_type: 'PrimitiveInt', inputs: { value: 1216 } },
    } as unknown as ComfyUIWorkflow;
    expect(listResolutionTargets(workflow)).toHaveLength(1);
  });

  it('跳过连线引用与缺失尺寸的节点', () => {
    const workflow = {
      '1': { class_type: 'A', inputs: { width: ['2', 0], height: 512 } },
      '2': { class_type: 'B', inputs: { width: 512 } },
    } as unknown as ComfyUIWorkflow;
    expect(listResolutionTargets(workflow)).toHaveLength(0);
  });

  it('按节点 ID 数值序排列', () => {
    const workflow = {
      '10': { class_type: 'A', inputs: { width: 512, height: 512 } },
      '2': { class_type: 'B', inputs: { width: 512, height: 512 } },
    } as unknown as ComfyUIWorkflow;
    expect(listResolutionTargets(workflow).map(t => t.nodeId)).toEqual(['2', '10']);
  });
});
