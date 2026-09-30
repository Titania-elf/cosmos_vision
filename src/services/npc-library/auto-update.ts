import { event_types, eventSource } from '@sillytavern/script';

import { NPC_AUTO_SCAN_FLOOR_COUNT, NPC_LIBRARY_GLOBAL_GROUP } from '@/constants/npc-library';
import { extractNpcCandidates } from '@/services/npc-library/extract';
import { applyNpcMergePlans, planNpcMerges } from '@/services/npc-library/merge';
import { collectProtagonistNames } from '@/services/npc-library/scan';
import { readChatContextEndingAt } from '@/services/npc-library/scan-context';
import { readNpcLibraryEntries } from '@/services/npc-library/store';
import { getCurrentCharacterKey } from '@/services/tavern-helper/prompt-profiles-context';
import { useSettingsStore } from '@/store/settings';

/** 自动更新来源备注 */
const AUTO_SOURCE_NOTE = '自动扫描';

let bound = false;
/** 串行护栏：一次只跑一个抽取，避免连续消息叠加请求 */
let running = false;

/**
 * 启动 NPC 库后台自动更新(幂等)
 * 监听 AI 消息渲染完成，读该楼上下文→抽取→合并→写库；总开关默认关，运行时按需读取
 */
export function startNpcLibraryAutoUpdate(): void {
  if (bound) return;
  bound = true;
  eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, handleMessageRendered);
}

/**
 * AI 消息渲染完成处理：按需后台更新 NPC 库
 * @param messageId 渲染完成的楼层号
 */
async function handleMessageRendered(messageId: unknown): Promise<void> {
  if (running) return;
  const store = useSettingsStore();
  const promptLlm = store.savedSettings.promptLlm;
  if (!promptLlm.autoUpdateNpcLibrary) return;
  const id = Number(messageId);
  if (!Number.isInteger(id) || id < 0) return;

  running = true;
  try {
    const context = await readChatContextEndingAt(id, NPC_AUTO_SCAN_FLOOR_COUNT, promptLlm.ignoreUserMessagesInHistory);
    if (!context) return;
    const candidates = await extractNpcCandidates(context, promptLlm, { excludeNames: collectProtagonistNames() });
    if (!candidates.length) return;
    const targetGroup = getCurrentCharacterKey() ?? NPC_LIBRARY_GLOBAL_GROUP;
    const existing = readNpcLibraryEntries();
    const plans = planNpcMerges(candidates, existing, targetGroup);
    const actionable = plans.filter(plan => plan.accepted && (plan.kind === 'create' || plan.kind === 'update'));
    if (!actionable.length) return;
    store.applyNpcLibrarySettings({ entries: applyNpcMergePlans(plans, existing, AUTO_SOURCE_NOTE) });
  } catch (error) {
    console.debug('[CosmosVision] NPC 库自动更新失败:', error);
  } finally {
    running = false;
  }
}
