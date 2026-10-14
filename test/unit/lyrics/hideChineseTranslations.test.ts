import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { hideChineseTranslations, isChineseText, shouldHideChineseTranslations } from '@/utils/lyrics/hideChineseTranslations';

const line = (overrides: Partial<Line>): Line => ({
  words: [],
  startTime: 0,
  endTime: 1,
  fullText: "I'm screamin'",
  ...overrides,
});

describe('isChineseText', () => {
  it.each([
    ['我像炉上水壶般沸腾嘶鸣', true],
    ['当然，我依然爱你。', true],
    ['詩情を持たずとも', false],
    ['사랑해', false],
    ['Te sigo queriendo', false],
    ['', false],
  ])('%s → %s', (text, expected) => {
    expect(isChineseText(text)).toBe(expected);
  });
});

describe('shouldHideChineseTranslations', () => {
  it('hides outside a Chinese interface only', () => {
    expect(shouldHideChineseTranslations('es')).toBe(true);
    expect(shouldHideChineseTranslations('en')).toBe(true);
    expect(shouldHideChineseTranslations('zh-CN')).toBe(false);
  });
});

describe('hideChineseTranslations', () => {
  it('drops Chinese translations and keeps romanization', () => {
    const [result] = hideChineseTranslations([line({ translation: '我像炉上水壶般沸腾嘶鸣', romanization: 'wo xiang' })]);
    expect(result.translation).toBeUndefined();
    expect(result.romanization).toBe('wo xiang');
  });

  it('keeps translations in other languages', () => {
    const lines = [line({ translation: 'Estoy gritando' })];
    expect(hideChineseTranslations(lines)).toBe(lines);
  });

  it('filters Chinese alternate translations but keeps the rest', () => {
    const [result] = hideChineseTranslations([line({
      alternateTexts: [
        { role: 'translation', language: 'zh-CN', text: '飓风之风' },
        { role: 'romanization', text: 'hurricane' },
        { role: 'translation', language: 'es', text: 'Viento de huracán' },
      ],
    })]);
    expect(result.alternateTexts?.map(alt => alt.text)).toEqual(['hurricane', 'Viento de huracán']);
  });

  it('cleans background vocals too', () => {
    const [result] = hideChineseTranslations([line({
      backgroundVocal: { text: 'ooh', startTime: 0, endTime: 1, words: [], translation: '哦' },
    })]);
    expect(result.backgroundVocal?.translation).toBeUndefined();
  });

  it('returns the same array when nothing changes', () => {
    const lines = [line({}), line({ translation: 'Hola' })];
    expect(hideChineseTranslations(lines)).toBe(lines);
  });
});
