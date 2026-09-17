import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRecipePresetName,
  countImportedRecipeLoras,
  createLoraOptionIndex,
  fetchComfyUILoraRecipes,
  mapRecipeLorasToSettings,
  parseLoraManagerRecipePage,
  resolveRecipePreviewUrl,
  type ComfyUILoraRecipeLora,
} from '@/services/comfyui/lora-recipes';
import { createMockFetch } from '../../../helpers/fetch-mocks';

/** 构造配方内 LoRA 条目 */
function createRecipeLora(overrides: Partial<ComfyUILoraRecipeLora> = {}): ComfyUILoraRecipeLora {
  return {
    fileName: 'Turbo-ANIMA-v2.9',
    localPath: null,
    strength: 0.7,
    excluded: false,
    inLibrary: true,
    ...overrides,
  };
}

describe('comfyui lora recipes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fetchComfyUILoraRecipes', () => {
    it('requests the recipes endpoint with paging, sorting and search', async () => {
      const fetchMock = createMockFetch(() => ({ json: { items: [], total: 0 } }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchComfyUILoraRecipes('http://127.0.0.1:8188/', {
        page: 2,
        pageSize: 20,
        search: 'witch hat',
        sortBy: 'name',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/api/lm/recipes?page=2&page_size=20&sort_by=name&search=witch+hat',
      );
    });

    it('omits the search parameter when the keyword is blank', async () => {
      const fetchMock = createMockFetch(() => ({ json: { items: [] } }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchComfyUILoraRecipes('http://127.0.0.1:8188', { page: 1, search: '   ' });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:8188/api/lm/recipes?page=1&page_size=40&sort_by=date',
      );
    });

    it('reports the missing manager on 404', async () => {
      vi.stubGlobal('fetch', createMockFetch(() => ({ status: 404 })));

      await expect(fetchComfyUILoraRecipes('http://127.0.0.1:8188')).rejects.toThrow(/ComfyUI-Lora-Manager/);
    });

    it('surfaces the server error body on failure', async () => {
      vi.stubGlobal('fetch', createMockFetch(() => ({ status: 500, json: { error: 'Recipe scanner unavailable' } })));

      await expect(fetchComfyUILoraRecipes('http://127.0.0.1:8188')).rejects.toThrow('Recipe scanner unavailable');
    });

    it('rejects when the ComfyUI url is empty', async () => {
      await expect(fetchComfyUILoraRecipes('')).rejects.toThrow('请先填写 ComfyUI URL');
    });
  });

  describe('parseLoraManagerRecipePage', () => {
    it('reads items, loras, base model and paging metadata', () => {
      const page = parseLoraManagerRecipePage(
        {
          items: [
            {
              id: 'recipe-1',
              title: '女巫风格',
              base_model: 'Anima',
              folder: '风格/暗黑',
              file_url: '/loras_static/recipe/1.webp',
              loras: [
                {
                  file_name: 'Turbo-ANIMA-v2.9',
                  localPath: 'Anima/细节与加速/Turbo-ANIMA-v2.9.safetensors',
                  strength: 0.7,
                  exclude: false,
                  inLibrary: true,
                },
                { file_name: 'missing_lora', strength: 1, exclude: true },
              ],
            },
          ],
          total: 41,
          page: 2,
          page_size: 20,
          total_pages: 3,
        },
        'http://127.0.0.1:8188',
        1,
        40,
      );

      expect(page).toEqual({
        items: [
          {
            id: 'recipe-1',
            title: '女巫风格',
            baseModel: 'Anima',
            folder: '风格/暗黑',
            previewUrl: 'http://127.0.0.1:8188/loras_static/recipe/1.webp',
            loras: [
              {
                fileName: 'Turbo-ANIMA-v2.9',
                localPath: 'Anima/细节与加速/Turbo-ANIMA-v2.9.safetensors',
                strength: 0.7,
                excluded: false,
                inLibrary: true,
              },
              {
                fileName: 'missing_lora',
                localPath: null,
                strength: 1,
                excluded: true,
                inLibrary: false,
              },
            ],
          },
        ],
        total: 41,
        page: 2,
        pageSize: 20,
        totalPages: 3,
      });
    });

    it('drops entries without id and tolerates missing fields', () => {
      const page = parseLoraManagerRecipePage(
        { items: [{ title: '无 id' }, { id: 'recipe-2' }, 'not-an-object'] },
        'http://127.0.0.1:8188',
        1,
        40,
      );

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({ id: 'recipe-2', title: '', baseModel: '', folder: '', loras: [] });
      // 响应未回显分页字段时回退请求参数
      expect(page).toMatchObject({ page: 1, pageSize: 40, total: 1, totalPages: 1 });
    });

    it('returns an empty page for a malformed payload', () => {
      expect(parseLoraManagerRecipePage(null, 'http://127.0.0.1:8188', 3, 20)).toEqual({
        items: [],
        total: 0,
        page: 3,
        pageSize: 20,
        totalPages: 0,
      });
    });

    it('falls back to strength 1 and empty localPath for partial lora entries', () => {
      const page = parseLoraManagerRecipePage(
        { items: [{ id: 'recipe-3', loras: [{ file_name: 'styled_lora' }, { strength: 1 }, 'bad'] }] },
        'http://127.0.0.1:8188',
        1,
        40,
      );

      expect(page.items[0]!.loras).toEqual([
        { fileName: 'styled_lora', localPath: null, strength: 1, excluded: false, inLibrary: false },
      ]);
    });
  });

  describe('resolveRecipePreviewUrl', () => {
    it('prefixes same-origin paths and keeps absolute urls', () => {
      expect(resolveRecipePreviewUrl('http://127.0.0.1:8188', '/loras_static/a.webp')).toBe(
        'http://127.0.0.1:8188/loras_static/a.webp',
      );
      expect(resolveRecipePreviewUrl('http://127.0.0.1:8188', 'loras_static/a.webp')).toBe(
        'http://127.0.0.1:8188/loras_static/a.webp',
      );
      expect(resolveRecipePreviewUrl('http://127.0.0.1:8188', 'https://cdn.test/a.webp')).toBe('https://cdn.test/a.webp');
    });

    it('returns null for the placeholder and for missing values', () => {
      expect(resolveRecipePreviewUrl('http://127.0.0.1:8188', '/loras_static/images/no-preview.png')).toBeNull();
      expect(resolveRecipePreviewUrl('http://127.0.0.1:8188', '')).toBeNull();
      expect(resolveRecipePreviewUrl('http://127.0.0.1:8188', null)).toBeNull();
    });
  });

  describe('mapRecipeLorasToSettings', () => {
    const options = [
      'Anima/细节与加速/Turbo-ANIMA-v2.9.safetensors',
      'Anima2d画风/atomsphere_style_v1.2-anima-e20.sft',
      'other/Character.safetensors',
    ];

    it('matches by full local path and keeps the option value', () => {
      const index = createLoraOptionIndex(options);
      const result = mapRecipeLorasToSettings(
        [
          createRecipeLora({
            fileName: 'Turbo-ANIMA-v2.9',
            localPath: 'Anima/细节与加速/Turbo-ANIMA-v2.9.safetensors',
            strength: 0.75,
          }),
        ],
        index,
      );

      expect(result).toEqual({
        entries: [{ name: 'Anima/细节与加速/Turbo-ANIMA-v2.9.safetensors', strength: 0.75, enabled: true }],
        unmatched: [],
      });
    });

    it('falls back to the extension-less basename and ignores separator/case differences', () => {
      const index = createLoraOptionIndex(options);
      const result = mapRecipeLorasToSettings(
        [
          createRecipeLora({
            fileName: 'ATOMSPHERE_STYLE_v1.2-anima-e20',
            localPath: 'Anima2d画风\\atomsphere_style_v1.2-anima-e20.sft',
          }),
        ],
        index,
      );

      expect(result.entries[0]).toMatchObject({
        name: 'Anima2d画风/atomsphere_style_v1.2-anima-e20.sft',
        enabled: true,
      });
      expect(result.unmatched).toEqual([]);
    });

    it('skips excluded loras and dedupes repeated ones', () => {
      const index = createLoraOptionIndex(options);
      const result = mapRecipeLorasToSettings(
        [
          createRecipeLora({ fileName: 'Character', localPath: null }),
          createRecipeLora({ fileName: 'other/Character' }),
          createRecipeLora({ fileName: 'Character', excluded: true }),
        ],
        index,
      );

      expect(result.entries).toEqual([{ name: 'other/Character.safetensors', strength: 0.7, enabled: true }]);
    });

    it('keeps missing loras disabled so generation does not fail on unknown files', () => {
      const index = createLoraOptionIndex(options);
      const result = mapRecipeLorasToSettings(
        [createRecipeLora({ fileName: 'not_installed', localPath: 'Anima/未安装/not_installed.safetensors' })],
        index,
      );

      expect(result.entries).toEqual([
        { name: 'Anima/未安装/not_installed.safetensors', strength: 0.7, enabled: false },
      ]);
      expect(result.unmatched).toEqual(['Anima/未安装/not_installed.safetensors']);
    });

    it('clamps out-of-range strengths to the plugin range', () => {
      const index = createLoraOptionIndex(options);
      const result = mapRecipeLorasToSettings(
        [
          createRecipeLora({ fileName: 'Turbo-ANIMA-v2.9', strength: 9 }),
          createRecipeLora({ fileName: 'Character', strength: -9 }),
        ],
        index,
      );

      expect(result.entries.map(entry => entry.strength)).toEqual([5, -5]);
    });
  });

  describe('countImportedRecipeLoras', () => {
    it('counts only importable loras that exist locally', () => {
      const index = createLoraOptionIndex(['a/Styled.safetensors']);

      expect(
        countImportedRecipeLoras(
          [
            createRecipeLora({ fileName: 'Styled' }),
            createRecipeLora({ fileName: 'missing' }),
            createRecipeLora({ fileName: 'Styled', excluded: true }),
          ],
          index,
        ),
      ).toBe(1);
    });
  });

  describe('buildRecipePresetName', () => {
    it('truncates long titles and keeps short ones', () => {
      expect(buildRecipePresetName('女巫风格', 'Anima', [])).toBe('女巫风格');
      const long = buildRecipePresetName('a'.repeat(60), '', []);
      expect(long).toHaveLength(40);
      expect(long.endsWith('…')).toBe(true);
    });

    it('falls back to the base model when the title is empty', () => {
      expect(buildRecipePresetName('   ', 'Anima', [])).toBe('Anima 配方');
      expect(buildRecipePresetName('', '', [])).toBe('未命名配方');
    });

    it('appends a counter when the name is taken', () => {
      expect(buildRecipePresetName('女巫风格', '', ['女巫风格'])).toBe('女巫风格 (2)');
      expect(buildRecipePresetName('女巫风格', '', ['女巫风格', '女巫风格 (2)'])).toBe('女巫风格 (3)');
      expect(buildRecipePresetName('女巫风格', '', ['  '])).toBe('女巫风格');
    });
  });
});
