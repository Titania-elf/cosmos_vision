import { describe, expect, it } from 'vitest';
import {
  PERSON_TEMPLATE_END_TITLE,
  PERSON_TEMPLATE_START_TITLE,
  createCustomPromptPersonTemplateEntry,
  createDefaultPromptPersonTemplateEntries,
  refreshBuiltinPromptPersonTemplateEntries,
} from '@/services/prompt-profiles/runtime';

describe('refreshBuiltinPromptPersonTemplateEntries', () => {
  it('updates built-in entry content in place while keeping id, enabled state and position', () => {
    const [defaultStart, defaultEnd] = createDefaultPromptPersonTemplateEntries();
    const stale = [
      { id: 'start-id', title: PERSON_TEMPLATE_START_TITLE, enabled: false, content: '旧的人物开始文案' },
      { id: 'character-description:desc', title: '角色描述', enabled: true, content: '{{desc}}' },
      { ...createCustomPromptPersonTemplateEntry('外观补充', 'wet hair'), id: 'note-id' },
      { id: 'end-id', title: PERSON_TEMPLATE_END_TITLE, enabled: true, content: '旧的人物结束文案' },
    ];

    const next = refreshBuiltinPromptPersonTemplateEntries(stale);

    expect(next.map(entry => entry.id)).toEqual(['start-id', 'character-description:desc', 'note-id', 'end-id']);
    const start = next.find(entry => entry.title === PERSON_TEMPLATE_START_TITLE);
    expect(start?.content).toBe(defaultStart?.content);
    expect(start?.enabled).toBe(false); // 启用状态保留
    expect(next.find(entry => entry.title === PERSON_TEMPLATE_END_TITLE)?.content).toBe(defaultEnd?.content);
  });

  it('leaves source and custom entries untouched', () => {
    const custom = createCustomPromptPersonTemplateEntry('我的自定义', 'my custom content');
    const source = { id: 'user-persona:p1', title: '用户人设', enabled: true, content: '{{persona}}' };
    const next = refreshBuiltinPromptPersonTemplateEntries([
      ...createDefaultPromptPersonTemplateEntries(),
      custom,
      source,
    ]);

    expect(next.find(entry => entry.id === custom.id)).toEqual(custom);
    expect(next.find(entry => entry.id === source.id)).toEqual(source);
  });

  it('reinserts missing built-in entries with start on top and end at bottom', () => {
    const source = { id: 'character-description:desc', title: '角色描述', enabled: true, content: '{{desc}}' };
    const next = refreshBuiltinPromptPersonTemplateEntries([source]);

    expect(next[0]?.title).toBe(PERSON_TEMPLATE_START_TITLE);
    expect(next[next.length - 1]?.title).toBe(PERSON_TEMPLATE_END_TITLE);
    expect(next.find(entry => entry.id === source.id)).toEqual(source);
  });
});
