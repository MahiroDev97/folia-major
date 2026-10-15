import type { WebLyricClock } from '../types/webLyricSource';

// src/utils/smtcSession.ts
// Pure helpers for the SMTC Stage source (Windows media sessions published by Spotify, browsers
// playing YouTube, and other players): pick the session to follow, turn a video title into
// something a lyric search can match, and build the lyric clock anchor.

export interface SmtcSessionLike {
  appId: string;
  title: string;
  artist: string;
  album: string;
  status: string;
  positionMs: number;
  durationMs: number;
  updatedAtMs: number;
}

/**
 * A version of a song whose lyrics are usually published under the original:
 * karaoke / instrumental (same song, same timing), a cover, or a cover sung in another language.
 */
export type SmtcVersionKind = 'karaoke' | 'instrumental' | 'cover' | 'foreign';

export interface SmtcCleanTrack {
  title: string;
  artist: string;
  version: SmtcVersionKind | null;
  /** The same upload read the other way round ("Title - Artist"), when the order is unclear. */
  swapped?: { title: string; artist: string };
  /** Extra words from the upload title ("Mulán" in "Mi Reflejo | Mulán | Karaoke"), used as an album hint. */
  context?: string;
}

export const isSpotifySmtcApp = (appId: string): boolean => /spotify/i.test(appId);

// Follows whatever is playing; when several play at once, the one that changed most recently.
// Nothing playing: stay on the session Windows calls current, else the latest paused one.
export function pickActiveSmtcSession<T extends SmtcSessionLike>(sessions: T[], currentAppId: string | null): T | null {
  const withTitle = sessions.filter(session => session.title.trim());
  if (withTitle.length === 0) {
    return null;
  }

  const byRecency = (a: T, b: T) => b.updatedAtMs - a.updatedAtMs;
  const playing = withTitle.filter(session => session.status === 'playing').sort(byRecency);
  if (playing.length > 0) {
    return playing[0];
  }

  return withTitle.find(session => session.appId === currentAppId) ?? [...withTitle].sort(byRecency)[0];
}

const NOISE_WORDS = [
  'official', 'oficial', 'video', 'vídeo', 'audio', 'lyric', 'lyrics', 'letra', 'mv', 'm/v', 'pv', 'hd', 'hq', '4k',
  'visualizer', 'visualiser', 'full', 'remaster', 'remastered', 'en vivo', 'live', 'color coded', 'sub español',
  'subtitulado', 'sub', 'cc', '歌詞', '字幕', 'music video', 'kanji', 'romaji', 'romanized', 'romanization', 'eng', 'esp',
];
const NOISE_GROUP = new RegExp(
  `\\s*[(\\[【「『〔]([^)\\]】」』〕]*?)[)\\]】」』〕]`,
  'g',
);
const FEAT = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?/i;
const ARTIST_SUFFIX = /\s*(?:-\s*topic|vevo|official(?:\s+channel)?|オフィシャル(?:チャンネル)?)\s*$/i;
const DASH_SPLIT = /\s+[-–—]\s+/;

const normalizeForCompare = (value: string) => value.toLowerCase().replace(/[\s*'’"]/g, '');

const stripNoiseGroups = (value: string) => value.replace(NOISE_GROUP, (match, inner: string) => {
  const lowered = inner.toLowerCase();
  return NOISE_WORDS.some(word => lowered.includes(word)) ? '' : match;
});

const tidy = (value: string) => value.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—|/]+|[\s\-–—|/]+$/g, '').trim();

// Checked in this order: a foreign-language cover is also a cover.
const VERSION_PATTERNS: Array<[SmtcVersionKind, RegExp]> = [
  ['foreign', /(?:spanish|español|espanol|castellano|latino|english|ingl[eé]s|japanese|japon[eé]s|portugu[eê]s|french|franc[eé]s)\s*(?:ver\.?|version|versi[oó]n|cover|dub|fandub)|versi[oó]n\s+(?:en\s+)?(?:español|espanol|castellano|latin[oa]|ingl[eé]s|japon[eé]s)|\bfandub\b|\bdub\s+(?:español|latino)|\b(?:español|espanol|latino|castellano)\b[\s\S]*\bcover\b|\bcover\b[\s\S]*\b(?:español|espanol|latino|castellano)\b/i],
  ['karaoke', /karaoke|カラオケ|\bktv\b/i],
  ['instrumental', /\binstrumental\b|off\s*vocal|\binst\.?(?=[)\]】\s]|$)|backing\s*track|伴奏|オフボーカル/i],
  ['cover', /\bcover(?:ed)?\b|歌ってみた|弾いてみた|翻唱|versi[oó]n\s+de\b/i],
];

export const detectSmtcVersion = (text: string): SmtcVersionKind | null => (
  VERSION_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null
);

const isVersionText = (text: string) => detectSmtcVersion(text) !== null;

// The words that make a title a version, removed without touching the rest of the title.
const VERSION_PHRASES = /(?:\bfull\s+)?(?:spanish|español|espanol|castellano|latino|english|ingl[eé]s|japanese|japon[eé]s)\s*(?:ver\.?|version|versi[oó]n|cover|dub|fandub)\b|versi[oó]n\s+(?:en\s+)?(?:español|espanol|castellano|latin[oa]|ingl[eé]s|japon[eé]s)|\b(?:synthv|utau|vocaloid)?\s*(?:karaoke|instrumental|off\s*vocal|backing\s*track)(?:\s+ver(?:sion|\.)?)?\b|\b(?:synthv|utau|vocaloid)?\s*cover(?:ed)?\b(?:\s+by\s+.+$)?|歌ってみた|弾いてみた|翻唱|カラオケ|オフボーカル|伴奏|\bfandub\b/gi;
// Inside 『』/「」 the title is usually kept with tags like "FULL ESPAÑOL" or "TV size".
const QUOTE_NOISE = /\b(?:full|tv\s*size|short|ver\.?|version|versi[oó]n|español|espanol|latino|castellano|english|cover)\b/gi;
const QUOTED_TITLE = /[『「]([^』」]+)[』」]/;
const LEADING_TAG = /^\s*(?:【[^】]*】|\[[^\]]*\])\s*/;
// "Igaku / Medicine", "Romaji / 日本語": one song named twice.
const ALIAS_TITLES = /\S\s+\/\s+\S/;

// Drops "(Karaoke Version)", "【歌ってみた】", " - Spanish Cover" and the like, keeping the song title.
const stripVersionTags = (value: string) => value
  .replace(NOISE_GROUP, (match, inner: string) => (isVersionText(inner) ? '' : match))
  .replace(VERSION_PHRASES, ' ');

// Upload tags in front of the title: 【MV】, 【Kasane Teto SV2】, [AMV]… as long as a title remains.
const stripLeadingTags = (value: string) => {
  let current = value;
  while (LEADING_TAG.test(current)) {
    const next = current.replace(LEADING_TAG, '');
    if (!next.trim()) break;
    current = next;
  }
  return current;
};

const looksLikeArtist = (candidate: string, channel: string) => {
  const a = normalizeForCompare(candidate);
  const b = normalizeForCompare(channel);
  return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
};

const finish = (title: string, artist: string) => ({
  title: tidy(title.replace(FEAT, '')),
  artist: tidy(artist.replace(FEAT, '').replace(ARTIST_SUFFIX, '')),
});

// Spotify already publishes clean title/artist. Browsers publish the video title and the channel
// name, e.g. "DECO*27 - ボルテッカー feat. 初音ミク" by "DECO*27", or "Despacito" by "Luis Fonsi - Topic".
// Karaoke, instrumental and cover uploads are reported in `version` and their tags removed, so the
// lyric search finds the original song. "A - B" is read against the channel name; when neither side
// is the channel, `swapped` carries the other reading for the search to try as well.
export function cleanSmtcTrack(session: Pick<SmtcSessionLike, 'appId' | 'title' | 'artist'>): SmtcCleanTrack {
  const rawTitle = session.title.trim();
  const rawArtist = session.artist.trim();
  const version = detectSmtcVersion(rawTitle);
  if (isSpotifySmtcApp(session.appId)) {
    return { title: version ? tidy(stripVersionTags(rawTitle)) || rawTitle : rawTitle, artist: rawArtist, version };
  }

  const channel = rawArtist.replace(ARTIST_SUFFIX, '').trim();
  // A 『』/「」 group is the title unless it only holds a tag (「KARAOKE」, 『歌ってみた』).
  const quotedMatch = rawTitle.match(QUOTED_TITLE);
  const quoted = quotedMatch ? stripVersionTags(quotedMatch[1]).replace(QUOTE_NOISE, ' ') : '';
  if (quotedMatch && tidy(quoted)) {
    const { title, artist } = finish(quoted, channel);
    return { title, artist, version };
  }
  const withoutTagQuote = quotedMatch ? rawTitle.replace(quotedMatch[0], ' ') : rawTitle;

  // "Mi Reflejo | Mulán | Karaoke": the other "|" segments often name the film, game or album.
  const contextParts = stripNoiseGroups(stripLeadingTags(withoutTagQuote)).split(/\s+\|\s+/).slice(1)
    .map(part => tidy(stripVersionTags(part)))
    .filter(part => /\p{L}/u.test(part) && !isVersionText(part) && !looksLikeArtist(part, channel));
  const hint = contextParts.length ? { context: contextParts.join(' ') } : {};

  const text = stripVersionTags(stripNoiseGroups(stripLeadingTags(withoutTagQuote)).split(/\s+\|\s+/)[0]);
  const dashParts = text.split(DASH_SPLIT).filter(part => tidy(part));
  if (dashParts.length >= 2) {
    const left = dashParts[0];
    const right = dashParts.slice(1).join(' - ');
    if (looksLikeArtist(right, channel) && !looksLikeArtist(left, channel)) {
      return { ...finish(left, right), version, ...hint };
    }
    const primary = finish(right, left);
    if (looksLikeArtist(left, channel)) {
      return { ...primary, version, ...hint };
    }
    // "Yararara / ヤラララ - ABM", "Igaku / Medicine - Kasane Teto SV": the side naming the song
    // twice is the title; both names are searched.
    const bilingual = (side: string) => ALIAS_TITLES.test(side);
    if (bilingual(left) !== bilingual(right)) {
      const [first, second] = (bilingual(left) ? left : right).split(/\s+\/\s+/);
      const artist = bilingual(left) ? right : left;
      return { ...finish(first, artist), version, ...hint, swapped: finish(second, artist) };
    }
    return { ...primary, version, ...hint, swapped: finish(left, right) };
  }

  const slashParts = text.split(/\s+\/\s+/);
  // Japanese uploads usually read "Title / Artist".
  if (slashParts.length === 2 && (!channel || looksLikeArtist(slashParts[1], channel))) {
    return { ...finish(slashParts[0], slashParts[1]), version, ...hint };
  }

  const { title, artist } = finish(text, channel);
  return { title: title || rawTitle, artist, version, ...hint };
}

export const smtcTrackKey = (session: Pick<SmtcSessionLike, 'appId' | 'title' | 'artist'>): string => (
  `${session.appId}|${session.title}|${session.artist}`
);

// positionMs was measured at updatedAtMs, so that is the anchor; the shared extrapolation
// (currentWebLyricTimeSec) adds the elapsed time while playing.
export function smtcSessionClock(session: SmtcSessionLike, nowMs: number): WebLyricClock {
  return {
    positionSec: Math.max(0, session.positionMs / 1000),
    durationSec: Math.max(0, session.durationMs / 1000),
    anchoredAtMs: session.updatedAtMs > 0 ? Math.min(session.updatedAtMs, nowMs) : nowMs,
    playing: session.status === 'playing',
  };
}

const CJK_OR_KANA = /[぀-ヿ㐀-鿿]/;
const GUARDED_SCRIPTS = [
  /[Ѐ-ӿ]/g, // Cyrillic
  /[가-힯ᄀ-ᇿ]/g, // Hangul
  /[؀-ۿ]/g, // Arabic
  /[֐-׿]/g, // Hebrew
  /[฀-๿]/g, // Thai
  /[Ͱ-Ͽ]/g, // Greek
  /[ऀ-ॿ]/g, // Devanagari
];

/**
 * False when lyrics found for a version (karaoke, cover) or for a Japanese/Chinese title are mostly
 * written in a script the title and artist never use: a Russian cover of a Vocaloid song is not the
 * song playing. Plain tracks with Latin titles are left alone (K-pop titles are often in English).
 */
export function lyricsScriptFitsTrack(lyricText: string, track: Pick<SmtcCleanTrack, 'version'>, trackText: string): boolean {
  if (!track.version && !CJK_OR_KANA.test(trackText)) return true;
  const letters = lyricText.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return true;
  return GUARDED_SCRIPTS.every((pattern) => {
    const share = (letters.match(pattern) ?? []).length / letters.length;
    return share <= 0.3 || new RegExp(pattern.source).test(trackText);
  });
}

/** A stable negative song id for an SMTC upload, clear of the small negative ids other Stage sources count down. */
export function stableStageSongId(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(i)) | 0;
  }
  return -(1_000_000 + (Math.abs(hash) % 1_000_000_000));
}
