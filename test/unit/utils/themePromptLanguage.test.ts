import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { THEME_GENERATION_PROMPT_PREFIX } from '@/utils/aiThemePrompts';
import { localizeThemePromptText, localizeThemeSchema, resolveThemePromptLanguage } from '../../../shared/themePromptLanguage.mjs';

const require = createRequire(import.meta.url);
const cjs = require('../../../shared/themePromptLanguage.cjs');

const CJK = /[一-鿿]/;

describe('themePromptLanguage', () => {
  it('maps app locales to prompt languages', () => {
    expect(resolveThemePromptLanguage('es')).toBe('es');
    expect(resolveThemePromptLanguage('es-CL')).toBe('es');
    expect(resolveThemePromptLanguage('en')).toBe('en');
    expect(resolveThemePromptLanguage('zh-CN')).toBeNull();
    expect(resolveThemePromptLanguage('in')).toBeNull();
  });

  it('removes every Chinese requirement from the Spanish prompt', () => {
    const prompt = localizeThemePromptText(THEME_GENERATION_PROMPT_PREFIX, 'es');
    expect(prompt).not.toMatch(/Chinese/);
    expect(prompt).not.toMatch(CJK);
    expect(prompt).toContain('neutral Latin American Spanish');
    expect(prompt).toContain('"name": "string (max 4 words, in neutral Spanish)"');
  });

  it('leaves the Chinese prompt untouched', () => {
    expect(localizeThemePromptText(THEME_GENERATION_PROMPT_PREFIX, 'zh-CN')).toBe(THEME_GENERATION_PROMPT_PREFIX);
  });

  it('rewrites schema descriptions without breaking the JSON', () => {
    const schema = {
      properties: {
        name: { type: 'string', description: 'A creative name for this light theme in Chinese, strictly limited to 10 characters or less' },
        description: { type: 'string', description: 'A creative 1-sentence description of the mood or visual concept in Chinese, strictly limited to 15 to 30 Chinese characters' },
      },
    };
    const localized = localizeThemeSchema(schema, 'es') as typeof schema;
    expect(localized.properties.name.description).toBe('A creative name for this light theme in neutral Spanish, at most 4 words');
    expect(localized.properties.description.description).toMatch(/in neutral Spanish, 6 to 16 words$/);
    expect(schema.properties.name.description).toMatch(/Chinese/);
  });

  it('keeps the CommonJS twin identical', () => {
    for (const locale of ['es', 'en', 'zh-CN']) {
      expect(cjs.localizeThemePromptText(THEME_GENERATION_PROMPT_PREFIX, locale))
        .toBe(localizeThemePromptText(THEME_GENERATION_PROMPT_PREFIX, locale));
    }
  });
});
