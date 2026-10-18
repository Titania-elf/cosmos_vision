import {
  chat,
  event_types,
  eventSource,
  getCurrentChatId,
  setExtensionPrompt,
  extension_prompt_types,
  extension_prompt_roles,
} from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { watch, type WatchStopHandle } from 'vue';
import { NPC_LIBRARY_GLOBAL_GROUP } from '@/constants/npc-library';
import { getCurrentCharacterKey, getCurrentUserPersonaKey } from '@/services/tavern-helper/prompt-profiles-context';
import { useSettingsStore } from '@/store/settings';
import { buildNpcAutoCreatePrompt } from './auto-prompt';
import { applyNpcFirstAppearances } from './first-appearance';
import { NPC_RECORD_COMMENT_SOURCE, parseNpcRecords } from './records';

const PROMPT_KEY = 'cosmos_vision_npc_auto_create';
let bound = false;
let generationType = '';
let stopSettingsWatch: WatchStopHandle | undefined;

/** 当前主角与用户不作为配角建档。 */
function collectProtagonistNames(): string[] {
  return [getCurrentCharacterKey(), getCurrentUserPersonaKey()].filter((name): name is string => Boolean(name));
}

/** 隐藏模型输出的记录，仅作用于显示和 prompt，保留原始消息与各 swipe 中的数据。 */
export function installNpcHiddenRegex(): void {
  const id = 'cosmos-vision-npcs-hidden';
  const scripts = Array.isArray(extension_settings.regex) ? extension_settings.regex : [];
  extension_settings.regex = [
    ...scripts.filter(script => script.id !== id),
    {
      id,
      scriptName: 'Cosmos Vision · 隐藏 NPC 建档记录',
      findRegex: `/${NPC_RECORD_COMMENT_SOURCE}/gi`,
      replaceString: '',
      trimStrings: [],
      placement: [2],
      disabled: false,
      markdownOnly: true,
      promptOnly: true,
      runOnEdit: true,
      substituteRegex: 0,
      minDepth: -1,
      maxDepth: -1,
    },
  ];
}

/** 即时更新建档规则与已建档名单；quiet/impersonate 不附加记录要求。 */
export function refreshNpcAutoCreatePrompt(): void {
  const settings = useSettingsStore().savedSettings;
  const enabled =
    getCurrentChatId() &&
    settings.enabled &&
    settings.promptLlm.autoUpdateNpcLibrary &&
    generationType !== 'quiet' &&
    generationType !== 'impersonate';
  const value = enabled
    ? buildNpcAutoCreatePrompt(
        settings.npcLibrary.entries,
        getCurrentCharacterKey() ?? NPC_LIBRARY_GLOBAL_GROUP,
        collectProtagonistNames(),
      )
    : '';
  setExtensionPrompt(PROMPT_KEY, value, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
}

/** 回复完成时只解析本地隐藏记录，不发起额外 API 请求。 */
function handleMessageRecorded(messageId: unknown): void {
  const store = useSettingsStore();
  if (!store.savedSettings.enabled || !store.savedSettings.promptLlm.autoUpdateNpcLibrary || !getCurrentChatId())
    return;
  if (generationType === 'quiet' || generationType === 'impersonate') return;
  if (typeof messageId !== 'number' && (typeof messageId !== 'string' || !/^\d+$/.test(messageId))) return;
  const id = Number(messageId);
  const message = Number.isInteger(id) && id >= 0 ? chat[id] : undefined;
  if (!message || message.is_user || message.is_system) return;
  const candidates = parseNpcRecords(message.mes, collectProtagonistNames());
  if (!candidates.length) return;
  const existing = store.savedSettings.npcLibrary.entries;
  const entries = applyNpcFirstAppearances(candidates, existing, getCurrentCharacterKey() ?? NPC_LIBRARY_GLOBAL_GROUP);
  if (entries !== existing) store.applyNpcLibrarySettings({ entries });
}

function handleChatChanged(): void {
  generationType = '';
  refreshNpcAutoCreatePrompt();
}

function handleGenerationStarted(type: unknown): void {
  generationType = typeof type === 'string' ? type : '';
  refreshNpcAutoCreatePrompt();
}

const messageEvents = ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED'] as const;

/** 保留原开关以兼容设置；自动建档改为主聊天随正文记录。 */
export function startNpcLibraryAutoUpdate(): void {
  if (bound) return;
  bound = true;
  installNpcHiddenRegex();
  for (const key of messageEvents) eventSource.on(event_types[key], handleMessageRecorded);
  eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);
  eventSource.on(event_types.GENERATION_AFTER_COMMANDS, handleGenerationStarted);
  eventSource.on(event_types.GENERATION_ENDED, handleChatChanged);
  eventSource.on(event_types.GENERATION_STOPPED, handleChatChanged);
  const store = useSettingsStore();
  stopSettingsWatch = watch(
    () => [
      store.savedSettings.enabled,
      store.savedSettings.promptLlm.autoUpdateNpcLibrary,
      store.savedSettings.npcLibrary.entries,
    ],
    refreshNpcAutoCreatePrompt,
    { deep: true, immediate: true, flush: 'sync' },
  );
}

export function stopNpcLibraryAutoUpdate(): void {
  if (!bound) return;
  bound = false;
  stopSettingsWatch?.();
  stopSettingsWatch = undefined;
  for (const key of messageEvents) eventSource.removeListener(event_types[key], handleMessageRecorded);
  eventSource.removeListener(event_types.CHAT_CHANGED, handleChatChanged);
  eventSource.removeListener(event_types.GENERATION_AFTER_COMMANDS, handleGenerationStarted);
  eventSource.removeListener(event_types.GENERATION_ENDED, handleChatChanged);
  eventSource.removeListener(event_types.GENERATION_STOPPED, handleChatChanged);
  generationType = '';
  setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
}
