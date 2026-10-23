import type { LyricAlternateText, LyricBackgroundVocal, Line } from '../../types';

// src/utils/lyrics/hideChineseTranslations.ts
// Online lyric sources attach translations that are always Simplified Chinese.
// Outside a Chinese interface they are noise, so the visualizer drops them; romanization and
// translations in any other language are kept. Lines without changes keep their identity.

const HAN = /[㐀-䶿一-鿿]/;
const KANA_OR_HANGUL = /[぀-ヿ가-힯]/;

/** Chinese text: has Han characters and no kana/hangul (which would make it Japanese/Korean). */
export const isChineseText = (text: string | undefined): boolean => (
  Boolean(text && HAN.test(text) && !KANA_OR_HANGUL.test(text))
);

export const shouldHideChineseTranslations = (uiLanguage: string | undefined): boolean => (
  !String(uiLanguage || '').toLowerCase().startsWith('zh')
);

const isChineseTranslation = (alternate: LyricAlternateText) => (
  alternate.role === 'translation' && (alternate.language?.toLowerCase().startsWith('zh') || isChineseText(alternate.text))
);

function stripAlternates(alternates: LyricAlternateText[] | undefined) {
  if (!alternates?.some(isChineseTranslation)) {
    return alternates;
  }
  return alternates.filter(alternate => !isChineseTranslation(alternate));
}

function stripVocal(vocal: LyricBackgroundVocal): LyricBackgroundVocal {
  const alternateTexts = stripAlternates(vocal.alternateTexts);
  const dropTranslation = isChineseText(vocal.translation);
  if (!dropTranslation && alternateTexts === vocal.alternateTexts) {
    return vocal;
  }
  return { ...vocal, translation: dropTranslation ? undefined : vocal.translation, alternateTexts };
}

function stripLine(line: Line): Line {
  const alternateTexts = stripAlternates(line.alternateTexts);
  const dropTranslation = isChineseText(line.translation);
  const backgroundVocal = line.backgroundVocal ? stripVocal(line.backgroundVocal) : line.backgroundVocal;
  const backgroundVocals = line.backgroundVocals?.map(stripVocal);
  const vocalsChanged = backgroundVocals?.some((vocal, index) => vocal !== line.backgroundVocals?.[index]);

  if (!dropTranslation && alternateTexts === line.alternateTexts && backgroundVocal === line.backgroundVocal && !vocalsChanged) {
    return line;
  }

  return {
    ...line,
    translation: dropTranslation ? undefined : line.translation,
    alternateTexts,
    backgroundVocal,
    backgroundVocals: vocalsChanged ? backgroundVocals : line.backgroundVocals,
  };
}

export function hideChineseTranslations(lines: Line[]): Line[] {
  let changed = false;
  const next = lines.map((line) => {
    const stripped = stripLine(line);
    if (stripped !== line) changed = true;
    return stripped;
  });
  return changed ? next : lines;
}
