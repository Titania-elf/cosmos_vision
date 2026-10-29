import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { chat_metadata, event_types, eventSource } from '@sillytavern/script';
import type { PromptPerson } from '@/constants/novelai';
import PromptProfilesSyncDialog from '@/panel/components/PromptProfilesSyncDialog.vue';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  scope: { kind: 'character', avatar: 'Story.png', chatId: 'current' },
}));
vi.mock('@/services/sillytavern/chats', () => ({
  getCurrentChatScope: () => mocks.scope,
  isSameChatScope: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
  listPastChats: mocks.list,
  readPastChatMetadata: mocks.read,
}));

function person(name: string, kind: 'character' | 'user' = 'character'): PromptPerson {
  return { id: `${kind}-${name}`, name, kind, enabled: true, insertMode: 'keyword', triggerKeywords: [name], staticTags: 'blue eyes', templateEntries: [] };
}
let wrapper: VueWrapper;
const confirm = vi.fn();

async function mountDialog(profiles: PromptPerson[] = [], kind: 'character' | 'user' = 'character'): Promise<void> {
  chat_metadata.cosmos_vision_profiles = profiles;
  wrapper = shallowMount(PromptProfilesSyncDialog, {
    props: { visible: true, kind, profiles },
    global: {
      provide: { showConfirm: confirm },
      stubs: {
        Dialog: { template: '<section><slot /><slot name="footer" /></section>' },
        Button: { props: ['label', 'disabled'], template: '<button :disabled="disabled">{{ label }}</button>' },
      },
    },
  });
  await flushPromises();
}

async function chooseSource(chatId = 'source'): Promise<void> {
  wrapper.findAllComponents({ name: 'Select' })[0].vm.$emit('update:modelValue', chatId);
  await nextTick();
  await flushPromises();
}

async function setMode(mode: 'missing' | 'overwrite'): Promise<void> {
  wrapper.findAllComponents({ name: 'Select' })[2].vm.$emit('update:modelValue', mode);
  await nextTick();
}

async function clickSync(): Promise<void> {
  await wrapper.findAll('button').find(button => button.text() === '确认同步')!.trigger('click');
  await flushPromises();
}

beforeEach(() => {
  mocks.scope = { kind: 'character', avatar: 'Story.png', chatId: 'current' };
  mocks.list.mockReset().mockResolvedValue([{ chatId: 'source', updatedAt: 0 }, { chatId: 'other', updatedAt: 0 }]);
  mocks.read.mockReset().mockResolvedValue({ cosmos_vision_profiles: [person('A'), person('User', 'user')] });
  confirm.mockReset().mockResolvedValue(true);
  delete chat_metadata.cosmos_vision_profiles;
});
afterEach(() => {
  wrapper?.unmount();
  delete chat_metadata.cosmos_vision_profiles;
});

describe('档案同步弹窗', () => {
  it('默认只选择当前分类，允许切到两类档案', async () => {
    await mountDialog([], 'user');
    await chooseSource();
    expect(wrapper.findAllComponents({ name: 'Checkbox' })).toHaveLength(1);
    wrapper.findAllComponents({ name: 'Select' })[1].vm.$emit('update:modelValue', 'all');
    await nextTick();
    expect(wrapper.findAllComponents({ name: 'Checkbox' })).toHaveLength(2);
    await clickSync();
    const [selected, mode, scope] = wrapper.emitted('sync')![0];
    expect((selected as PromptPerson[]).map(item => item.name)).toEqual(['A', 'User']);
    expect(mode).toBe('missing');
    expect(scope).toEqual(mocks.scope);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('可以取消全选并单独勾选，未选任何档案不能确认', async () => {
    await mountDialog();
    await chooseSource();
    await wrapper.findAll('button').find(button => button.text() === '取消全选')!.trigger('click');
    expect(wrapper.findAll('button').find(button => button.text() === '确认同步')!.attributes('disabled')).toBeDefined();
    wrapper.findComponent({ name: 'Checkbox' }).vm.$emit('update:modelValue', [0]);
    await nextTick();
    await clickSync();
    expect(wrapper.emitted('sync')).toHaveLength(1);
  });

  it('默认跳过同名档案，覆盖必须确认并能取消', async () => {
    await mountDialog([person('A')]);
    await chooseSource();
    expect(wrapper.text()).toContain('已有同名，跳过');
    expect(wrapper.findAll('button').find(button => button.text() === '确认同步')!.attributes('disabled')).toBeDefined();
    await setMode('overwrite');
    confirm.mockResolvedValueOnce(false);
    await clickSync();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ severity: 'danger', message: expect.stringContaining('「A」') }));
    expect(wrapper.emitted('sync')).toBeUndefined();
    await clickSync();
    expect(wrapper.emitted('sync')).toHaveLength(1);
  });

  it('重复同名来源提示冲突，不能自动选择覆盖对象', async () => {
    mocks.read.mockResolvedValue({ cosmos_vision_profiles: [person('A'), { ...person('A'), id: 'duplicate' }] });
    await mountDialog();
    await chooseSource();
    expect(wrapper.text()).toContain('存在同名冲突');
    expect(wrapper.findAll('button').find(button => button.text() === '确认同步')!.attributes('disabled')).toBeDefined();
    wrapper.findAllComponents({ name: 'Checkbox' })[0].vm.$emit('update:modelValue', [0]);
    await nextTick();
    await clickSync();
    expect(wrapper.emitted('sync')).toHaveLength(1);
  });

  it('来源不存在或读取失败不会提交', async () => {
    mocks.read.mockRejectedValue(new Error('来源聊天已不存在'));
    await mountDialog();
    await chooseSource();
    expect(wrapper.find('[role="alert"]').text()).toContain('已不存在');
    expect(wrapper.findAll('button').find(button => button.text() === '确认同步')!.attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('sync')).toBeUndefined();
  });

  it('快速改选来源，旧请求晚到不能覆盖新预览', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    mocks.read.mockResolvedValueOnce({ cosmos_vision_profiles: [person('New')] });
    await mountDialog();
    await chooseSource('source');
    const oldSignal = mocks.read.mock.calls[0][2] as AbortSignal;
    await chooseSource('other');
    expect(oldSignal.aborted).toBe(true);
    resolveOld({ cosmos_vision_profiles: [person('Old')] });
    await flushPromises();
    expect(wrapper.text()).toContain('New');
    expect(wrapper.text()).not.toContain('Old');
  });

  it('来源请求期间切换聊天，关闭弹窗并作废响应', async () => {
    let resolveSource!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { resolveSource = resolve; }));
    await mountDialog();
    await chooseSource();
    const signal = mocks.read.mock.calls[0][2] as AbortSignal;
    mocks.scope.chatId = 'switched';
    eventSource.emit(event_types.CHAT_CHANGED);
    await nextTick();
    expect(signal.aborted).toBe(true);
    expect(wrapper.emitted('update:visible')?.at(-1)).toEqual([false]);
    resolveSource({ cosmos_vision_profiles: [person('Late')] });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Late');
    expect(wrapper.emitted('sync')).toBeUndefined();
  });

  it('覆盖二次确认期间切换聊天，接受后也不能写入', async () => {
    let accept!: (value: boolean) => void;
    confirm.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    await mountDialog([person('A')]);
    await chooseSource();
    await setMode('overwrite');
    await clickSync();
    mocks.scope.avatar = 'Other.png';
    eventSource.emit(event_types.CHAT_CHANGED);
    accept(true);
    await flushPromises();
    expect(wrapper.emitted('sync')).toBeUndefined();
  });

  it('确认期间目标档案变化，刷新预览且不覆盖新编辑', async () => {
    let accept!: (value: boolean) => void;
    confirm.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
    await mountDialog([person('A')]);
    await chooseSource();
    await setMode('overwrite');
    await clickSync();
    chat_metadata.cosmos_vision_profiles = [{ ...person('A'), staticTags: 'new edit' }];
    accept(true);
    await flushPromises();
    expect(wrapper.emitted('refresh')).toHaveLength(1);
    expect(wrapper.emitted('sync')).toBeUndefined();
    expect(toastr.info).toHaveBeenCalledWith(expect.stringContaining('预览已更新'));
  });
});
