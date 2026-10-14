"use strict";

// shared/themePromptLanguage.cjs
// The AI theme prompt and its JSON schemas ask for a Chinese theme name and description. This
// rewrites those parts for the app's interface language so the generated theme reads naturally
// there. Chinese (and any language without an entry) keeps the prompt untouched.
// Keep in sync with shared/themePromptLanguage.mjs.

const CHINESE_NAME_RULE = 'The theme names must be in Chinese and strictly limited to 10 characters or less. They should reflect both the mood AND the mode (e.g., "忧郁破晓" for light, "忧郁子夜" for dark).';
const CHINESE_DESCRIPTION_RULE = 'The theme description must be a brief, emotional sentence in Chinese (strictly limited to 15 to 30 Chinese characters)';
const CHINESE_EXAMPLES = /Examples for reference: "戴上耳机[^\n]*/;
const CHINESE_SCHEMA_NAME = 'in Chinese, strictly limited to 10 characters or less';
const CHINESE_SCHEMA_DESCRIPTION = 'in Chinese, strictly limited to 15 to 30 Chinese characters';
const CHINESE_TEMPLATE_NAME = 'string (max 10 chars, in Chinese)';
const CHINESE_TEMPLATE_DESCRIPTION = 'string (15-30 chars, in Chinese)';

const LANGUAGES = {
  es: {
    language: 'neutral Latin American Spanish (informal "tú", never "vos")',
    nameRule: 'The theme names must be in neutral Latin American Spanish and strictly limited to 4 words (max 28 characters). They should reflect both the mood AND the mode (e.g., "Melancolía al alba" for light, "Melancolía de medianoche" for dark).',
    descriptionLength: 'strictly limited to 6 to 16 words',
    examples: 'Examples for reference: "En cuanto me pongo los audífonos, el ruido del mundo desaparece.", "Y entonces este amor tejió el sol y todas las estrellas.", "¿Tu mundo también me incluye a mí?", "Una brisa de mar en una noche de verano.", "La juventud es mirar siempre hacia lo lejos.", "Como volver a aquel verano de bebidas con gas y paseos en bici.".',
    schemaName: 'in neutral Spanish, at most 4 words',
    schemaDescription: 'in neutral Spanish, 6 to 16 words',
  },
  en: {
    language: 'English',
    nameRule: 'The theme names must be in English and strictly limited to 4 words (max 28 characters). They should reflect both the mood AND the mode (e.g., "Melancholy Dawn" for light, "Melancholy Midnight" for dark).',
    descriptionLength: 'strictly limited to 6 to 16 words',
    examples: 'Examples for reference: "The moment I put on my headphones, the noisy world disappears.", "And then this love wove the sun and all the stars.", "Does your world include me too?", "A sea breeze on a tipsy summer night.", "Youth is a way of gazing into the distance!", "Like going back to that summer of soda and bike rides.".',
    schemaName: 'in English, at most 4 words',
    schemaDescription: 'in English, 6 to 16 words',
  },
};

/** Maps an app locale ('es', 'es-CL', 'en', 'zh-CN', 'in', …) to a supported prompt language, or null. */
function resolveThemePromptLanguage(locale) {
  const lowered = String(locale || '').toLowerCase();
  if (lowered.startsWith('es')) return 'es';
  if (lowered.startsWith('en')) return 'en';
  return null;
}

function localizeThemePromptText(text, locale) {
  const config = LANGUAGES[resolveThemePromptLanguage(locale)];
  if (!config || typeof text !== 'string') {
    return text;
  }

  return text
    .replace(CHINESE_NAME_RULE, config.nameRule)
    .replace(CHINESE_DESCRIPTION_RULE, `The theme description must be a brief, emotional sentence in ${config.language} (${config.descriptionLength})`)
    .replace(CHINESE_EXAMPLES, config.examples)
    .split(CHINESE_SCHEMA_NAME).join(config.schemaName)
    .split(CHINESE_SCHEMA_DESCRIPTION).join(config.schemaDescription)
    .split(CHINESE_TEMPLATE_NAME).join(`string (max 4 words, ${config.schemaName.replace(/, at most 4 words$/, '')})`)
    .split(CHINESE_TEMPLATE_DESCRIPTION).join(`string (6-16 words, ${config.schemaDescription.replace(/, 6 to 16 words$/, '')})`);
}

/** Same rewrite for a JSON schema object (its description strings). Returns a new object. */
function localizeThemeSchema(schema, locale) {
  if (!resolveThemePromptLanguage(locale)) {
    return schema;
  }
  return JSON.parse(localizeThemePromptText(JSON.stringify(schema), locale));
}

module.exports = { resolveThemePromptLanguage, localizeThemePromptText, localizeThemeSchema };
