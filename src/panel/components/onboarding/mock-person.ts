/**
 * 教程模拟人物注入器
 * 在角色配置教程步骤中，向当前聊天人物档案临时注入示例人物用于演示；
 * 条目编辑演示通过响应式标记驱动人物页真实打开条目编辑弹窗；教程结束后全部清理
 */

import { readonly, ref } from 'vue';

import { createPromptPerson } from '@/services/prompt-profiles/runtime';
import { persistChatProfiles, readChatProfiles } from '@/services/prompt-profiles/chat-store';

/** 模拟人物固定 ID，用于识别与清理 */
const MOCK_PERSON_ID = '__cv_tutorial_mock_person__';

/** 模拟示例固定 tag */
const MOCK_STATIC_TAGS = 'girl, blue eyes, long hair, white dress';

/** 教程请求打开条目编辑弹窗的响应式标记，由人物页监听并真实打开弹窗 */
const isMockEntryEditorRequested = ref(false);

/** 供人物页监听的只读标记 */
export const mockEntryEditorRequested = readonly(isMockEntryEditorRequested);

/**
 * 判断是否为教程模拟人物
 * @param id 人物 ID
 * @returns 是否为模拟人物
 */
export function isTutorialMockPersonId(id: string): boolean {
  return id === MOCK_PERSON_ID;
}

/**
 * 向当前聊天人物档案注入模拟人物（幂等）
 * 演示人物也写入 chat_metadata：保证人物页读取路径与真实数据一致；
 * 教程结束后由 cleanupMockPerson 落盘移除
 */
export function injectMockPerson(): void {
  const profiles = readChatProfiles();
  if (profiles.some(person => isTutorialMockPersonId(person.id))) return;

  const mockPerson = createPromptPerson('character', '教程示例角色', ['示例角色']);
  mockPerson.id = MOCK_PERSON_ID;
  mockPerson.staticTags = MOCK_STATIC_TAGS;
  profiles.push(mockPerson);
  persistChatProfiles(profiles);
}

/**
 * 从当前聊天人物档案移除模拟人物
 */
export function cleanupMockPerson(): void {
  const profiles = readChatProfiles();
  const index = profiles.findIndex(person => isTutorialMockPersonId(person.id));
  if (index === -1) return;
  profiles.splice(index, 1);
  persistChatProfiles(profiles);
}

/**
 * 请求打开模拟人物的条目编辑弹窗（真实弹窗，由人物页响应）
 */
export function injectMockEntryEditor(): void {
  isMockEntryEditorRequested.value = true;
}

/**
 * 请求关闭条目编辑弹窗
 */
export function cleanupMockEntryEditor(): void {
  isMockEntryEditorRequested.value = false;
}
