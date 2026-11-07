import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_PERSON_FIXED_NEGATIVE_TAGS_BLOCK,
  DEFAULT_PROMPT_PERSON_FIXED_POSITIVE_TAGS_BLOCK,
  PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN,
  PROMPT_LLM_FIXED_POSITIVE_TAGS_TOKEN,
  PROMPT_LLM_FIXED_TAGS_TOKEN,
} from '@/constants/default-settings';
import type { PromptPerson } from '@/constants/novelai';
import {
  PERSON_TEMPLATE_END_TITLE,
  PERSON_TEMPLATE_START_TITLE,
  createCustomPromptPersonTemplateEntry,
  createDefaultPromptPersonTemplateEntries,
  createPromptPerson,
  hasPersonStartEntry,
  hasUnreferencedFixedNegativeTags,
  hasUnreferencedFixedTags,
  overwritePersonStartEntryWithDefaults,
  refreshBuiltinPromptPersonTemplateEntries,
  replacePromptPersonTemplateTokens,
  stripEmptyFixedNegativeTagsBlocks,
  stripEmptyFixedTagsBlocks,
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

describe('prompt-profiles runtime', () => {
  describe('createPromptPerson', () => {
    it('creates person with default empty staticTags and negativeTags', () => {
      const person = createPromptPerson('character', 'Alice');
      expect(person.name).toBe('Alice');
      expect(person.staticTags).toBe('');
      expect(person.negativeTags).toBe('');
      expect(person.templateEntries).toHaveLength(2);
    });
  });

  describe('createDefaultPromptPersonTemplateEntries', () => {
    it('contains negative block after positive block with all three key elements', () => {
      const entries = createDefaultPromptPersonTemplateEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].title).toBe('人物开始');
      expect(entries[1].title).toBe('人物结束');

      const content = entries[0].content;
      const positiveBlockIndex = content.indexOf('<fixed_positive_tags>');
      const negativeBlockIndex = content.indexOf('<fixed_negative_tags>');
      expect(positiveBlockIndex).toBeGreaterThan(-1);
      expect(negativeBlockIndex).toBeGreaterThan(-1);
      expect(negativeBlockIndex).toBeGreaterThan(positiveBlockIndex);

      // 块语义校验：负面原样体现 / 无需负面时忽略
      expect(content).toContain('必须原样体现在最终负面提示词中');
      expect(content).toContain('忽略本块');
      expect(content).toContain(PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN);
      // 新正负 tag 模板仍保留 fork 的场景/遮挡优先语义。
      expect(content).toContain('该优先级同样适用于 <fixed_negative_tags>');
      expect(content).toContain('与当前剧情场景冲突的负面条目必须舍弃');
      expect(content).toContain('在不与当前场景状态冲突、且该特征在画面中确实可见时');
      expect(content).toContain('遮挡 / 不可见优先');
      expect(content).toContain('对应固定正面tag必须省略');
      expect(DEFAULT_PROMPT_PERSON_FIXED_POSITIVE_TAGS_BLOCK).not.toContain('必须原样');
    });
  });

  describe('replacePromptPersonTemplateTokens & stripEmptyBlocks', () => {
    it('replaces both staticTags and negativeTags when both are provided', () => {
      const person: PromptPerson = {
        ...createPromptPerson('character', 'Bob'),
        staticTags: 'blue eyes, blonde hair',
        negativeTags: 'red eyes, short hair',
      };
      const template = `Prefix\n${DEFAULT_PROMPT_PERSON_FIXED_POSITIVE_TAGS_BLOCK}\n${DEFAULT_PROMPT_PERSON_FIXED_NEGATIVE_TAGS_BLOCK}\nSuffix`;
      const result = replacePromptPersonTemplateTokens(template, person);

      expect(result).toContain('blue eyes, blonde hair');
      expect(result).toContain('red eyes, short hair');
      expect(result).not.toContain(PROMPT_LLM_FIXED_POSITIVE_TAGS_TOKEN);
      expect(result).not.toContain(PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN);
    });

    it('replaces legacy fixed_tags token for existing templates', () => {
      const person: PromptPerson = {
        ...createPromptPerson('character', 'Bob'),
        staticTags: 'blue eyes',
        negativeTags: '',
      };
      const result = replacePromptPersonTemplateTokens(`X ${PROMPT_LLM_FIXED_TAGS_TOKEN} Y`, person);
      expect(result).toBe('X blue eyes Y');
    });

    it('strips empty fixed_positive_tags block when staticTags is empty', () => {
      const person: PromptPerson = {
        ...createPromptPerson('character', 'Bob'),
        staticTags: '   ',
        negativeTags: 'bad anatomy',
      };
      const template = `<fixed_positive_tags>Fixed: ${PROMPT_LLM_FIXED_POSITIVE_TAGS_TOKEN}</fixed_positive_tags>\n<fixed_negative_tags>Neg: ${PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN}</fixed_negative_tags>`;
      const result = replacePromptPersonTemplateTokens(template, person);

      expect(result).not.toContain('<fixed_positive_tags>');
      expect(result).not.toContain('Fixed:');
      expect(result).toContain('<fixed_negative_tags>Neg: bad anatomy</fixed_negative_tags>');
    });

    it('strips empty legacy fixed_tags block when staticTags is empty', () => {
      const person: PromptPerson = {
        ...createPromptPerson('character', 'Bob'),
        staticTags: '   ',
        negativeTags: 'bad anatomy',
      };
      const template = `<fixed_tags>Fixed: ${PROMPT_LLM_FIXED_TAGS_TOKEN}</fixed_tags>\n<fixed_negative_tags>Neg: ${PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN}</fixed_negative_tags>`;
      const result = replacePromptPersonTemplateTokens(template, person);

      expect(result).not.toContain('<fixed_tags>');
      expect(result).not.toContain('Fixed:');
      expect(result).toContain('<fixed_negative_tags>Neg: bad anatomy</fixed_negative_tags>');
    });

    it('strips empty fixed_negative_tags block when negativeTags is empty', () => {
      const person: PromptPerson = {
        ...createPromptPerson('character', 'Bob'),
        staticTags: 'masterpiece',
        negativeTags: '',
      };
      const template = `<fixed_tags>Fixed: ${PROMPT_LLM_FIXED_TAGS_TOKEN}</fixed_tags>\n<fixed_negative_tags>Neg: ${PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN}</fixed_negative_tags>`;
      const result = replacePromptPersonTemplateTokens(template, person);

      expect(result).toContain('<fixed_tags>Fixed: masterpiece</fixed_tags>');
      expect(result).not.toContain('<fixed_negative_tags>');
      expect(result).not.toContain('Neg:');
    });

    it('strips both blocks when both staticTags and negativeTags are empty', () => {
      const person: PromptPerson = {
        ...createPromptPerson('character', 'Bob'),
        staticTags: '',
        negativeTags: '',
      };
      const template = `Header\n<fixed_tags>${PROMPT_LLM_FIXED_TAGS_TOKEN}</fixed_tags>\n<fixed_negative_tags>${PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN}</fixed_negative_tags>\nFooter`;
      const result = replacePromptPersonTemplateTokens(template, person);

      expect(result).not.toContain('<fixed_tags>');
      expect(result).not.toContain('<fixed_negative_tags>');
      expect(result).toContain('Header');
      expect(result).toContain('Footer');
    });

    it('direct strip functions correctly clean target blocks', () => {
      const text = `A <fixed_tags>info ${PROMPT_LLM_FIXED_TAGS_TOKEN}</fixed_tags> B <fixed_negative_tags>neg ${PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN}</fixed_negative_tags> C`;
      expect(stripEmptyFixedTagsBlocks(text)).toBe(`A  B <fixed_negative_tags>neg ${PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN}</fixed_negative_tags> C`);
      expect(stripEmptyFixedNegativeTagsBlocks(text)).toBe(`A <fixed_tags>info ${PROMPT_LLM_FIXED_TAGS_TOKEN}</fixed_tags> B  C`);
    });
  });

  describe('unreferenced tags detection', () => {
    it('hasUnreferencedFixedTags returns true only when staticTags non-empty and no enabled entry references token', () => {
      const person = createPromptPerson('character', 'Charlie');
      person.staticTags = '';
      expect(hasUnreferencedFixedTags(person)).toBe(false);

      person.staticTags = 'cat ears';
      // Default template contains {{fixed_positive_tags}} in enabled '人物开始' entry
      expect(hasUnreferencedFixedTags(person)).toBe(false);

      // Disable the entry containing the token
      person.templateEntries[0].enabled = false;
      expect(hasUnreferencedFixedTags(person)).toBe(true);

      // 仅含旧版宏的启用条目同样视为已引用（存量模板兼容）
      person.templateEntries[0].enabled = true;
      person.templateEntries[0].content = 'legacy only: {{fixed_tags}}';
      expect(hasUnreferencedFixedTags(person)).toBe(false);

      // Clear content of entry
      person.templateEntries[0].content = 'no token here';
      expect(hasUnreferencedFixedTags(person)).toBe(true);
    });

    it('hasUnreferencedFixedNegativeTags returns true only when negativeTags non-empty and no enabled entry references token', () => {
      const person = createPromptPerson('character', 'Charlie');
      person.negativeTags = '';
      expect(hasUnreferencedFixedNegativeTags(person)).toBe(false);

      person.negativeTags = 'dog ears';
      // Default template contains {{fixed_negative_tags}} in enabled '人物开始' entry
      expect(hasUnreferencedFixedNegativeTags(person)).toBe(false);

      // Disable entry
      person.templateEntries[0].enabled = false;
      expect(hasUnreferencedFixedNegativeTags(person)).toBe(true);

      // Content without negative token
      person.templateEntries[0].enabled = true;
      person.templateEntries[0].content = 'only fixed_tags: {{fixed_tags}}';
      expect(hasUnreferencedFixedNegativeTags(person)).toBe(true);
    });
  });

  describe('overwritePersonStartEntryWithDefaults', () => {
    it('overwrites existing start entry with full default content', () => {
      const person = createPromptPerson('character', 'Dan');
      person.templateEntries[0].content = '<person name="x">';
      const result = overwritePersonStartEntryWithDefaults(person);
      expect(result).toBe('overwritten');
      expect(person.templateEntries[0].content).toBe(createDefaultPromptPersonTemplateEntries()[0].content);
      expect(person.templateEntries[0].content).toContain(PROMPT_LLM_FIXED_POSITIVE_TAGS_TOKEN);
      expect(person.templateEntries[0].content).toContain(PROMPT_LLM_FIXED_NEGATIVE_TAGS_TOKEN);
      expect(person.templateEntries[0].content).toContain('该优先级同样适用于 <fixed_negative_tags>');
    });

    it('replaces customized content entirely instead of appending missing blocks', () => {
      const person = createPromptPerson('character', 'Dan');
      person.templateEntries[0].content = '<person name="x">\n  user custom note\n';
      overwritePersonStartEntryWithDefaults(person);
      expect(person.templateEntries[0].content).not.toContain('user custom note');
      expect(person.templateEntries[0].content).toBe(createDefaultPromptPersonTemplateEntries()[0].content);
    });

    it('enables disabled start entry while overwriting', () => {
      const person = createPromptPerson('character', 'Dan');
      person.templateEntries[0].enabled = false;
      const result = overwritePersonStartEntryWithDefaults(person);
      expect(result).toBe('overwritten');
      expect(person.templateEntries[0].enabled).toBe(true);
    });

    it('hits renamed start entry by content detection and keeps its identity', () => {
      const person = createPromptPerson('character', 'Dan');
      const id = person.templateEntries[0].id;
      person.templateEntries[0].title = '开场';
      person.templateEntries[0].content = '<person name="x">';
      const result = overwritePersonStartEntryWithDefaults(person);
      expect(result).toBe('overwritten');
      expect(person.templateEntries[0].id).toBe(id);
      expect(person.templateEntries[0].title).toBe('开场');
      expect(person.templateEntries[0].content).toBe(createDefaultPromptPersonTemplateEntries()[0].content);
    });

    it('recreates default start entry when it was deleted', () => {
      const person = createPromptPerson('character', 'Dan');
      // 模拟"人物开始"被删、仅剩"人物结束"
      person.templateEntries = [person.templateEntries[1]];
      const result = overwritePersonStartEntryWithDefaults(person);
      expect(result).toBe('recreated');
      expect(person.templateEntries).toHaveLength(2);
      expect(person.templateEntries[0].title).toBe('人物开始');
      expect(person.templateEntries[0].content).toBe(createDefaultPromptPersonTemplateEntries()[0].content);
      expect(person.templateEntries[1].title).toBe('人物结束');
    });

    it('restores full default pair when templateEntries is empty', () => {
      const person = createPromptPerson('character', 'Dan');
      person.templateEntries = [];
      const result = overwritePersonStartEntryWithDefaults(person);
      expect(result).toBe('recreated');
      expect(person.templateEntries).toHaveLength(2);
      expect(person.templateEntries[0].title).toBe('人物开始');
      expect(person.templateEntries[1].title).toBe('人物结束');
    });
  });

  describe('hasPersonStartEntry', () => {
    it('detects start entry by content rather than title', () => {
      const person = createPromptPerson('character', 'Dan');
      expect(hasPersonStartEntry(person)).toBe(true);

      person.templateEntries[0].title = '开场';
      expect(hasPersonStartEntry(person)).toBe(true);

      person.templateEntries[0].content = 'no person tag here';
      expect(hasPersonStartEntry(person)).toBe(false);

      person.templateEntries = [];
      expect(hasPersonStartEntry(person)).toBe(false);
    });
  });
});
