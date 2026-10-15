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
  'subtitulado', 'sub', 'cc', '歌詞', '字幕', 'music video',
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
  ['foreign', /(?:spanish|español|espanol|castellano|latino|english|ingl[eé]s|japanese|japon[eé]s|portugu[eê]s|french|franc[eé]s)\s*(?:ver\.?|version|versi[oó]n|cover|dub|fandub)|versi[oó]n\s+(?:en\s+)?(?:español|espanol|castellano|latin[oa]|ingl[eé]s|japon[eé]s)|\bfandub\b|\bdub\s+(?:español|latino)/i],
  ['karaoke', /karaoke|カラオケ|\bktv\b/i],
  ['instrumental', /\binstrumental\b|off\s*vocal|\binst\.?(?=[)\]】\s]|$)|backing\s*track|伴奏|オフボーカル/i],
  ['cover', /\bcover(?:ed)?\b|歌ってみた|弾いてみた|翻唱|versi[oó]n\s+de\b/i],
];

export const detectSmtcVersion = (text: string): SmtcVersionKind | null => (
  VERSION_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null
);

const isVersionText = (text: string) => detectSmtcVersion(text) !== null;

// Drops "(Karaoke Version)", "【歌ってみた】", " - Spanish Cover" and the like, keeping the song title.
const stripVersionTags = (value: string) => value
  .replace(NOISE_GROUP, (match, inner: string) => (isVersionText(inner) ? '' : match))
  .split(DASH_SPLIT)
  .filter(part => !isVersionText(part) || part.split(/\s+/).length > 6)
  .join(' - ');

// Spotify already publishes clean title/artist. Browsers publish the video title and the channel
// name, e.g. "DECO*27 - ボルテッカー feat. 初音ミク" by "DECO*27", or "Despacito" by "Luis Fonsi - Topic".
// Karaoke, instrumental and cover uploads are reported in `version` and their tags removed, so the
// lyric search finds the original song.
export function cleanSmtcTrack(session: Pick<SmtcSessionLike, 'appId' | 'title' | 'artist'>): SmtcCleanTrack {
  const rawTitle = session.title.trim();
  const rawArtist = session.artist.trim();
  const version = detectSmtcVersion(rawTitle);
  if (isSpotifySmtcApp(session.appId)) {
    return { title: version ? tidy(stripVersionTags(rawTitle)) || rawTitle : rawTitle, artist: rawArtist, version };
  }

  let title = stripVersionTags(stripNoiseGroups(rawTitle).split(/\s+\|\s+/)[0]);
  let artist = rawArtist.replace(ARTIST_SUFFIX, '').trim();

  const dashParts = title.split(DASH_SPLIT);
  if (dashParts.length >= 2) {
    artist = dashParts[0];
    title = dashParts.slice(1).join(' - ');
  } else {
    const slashParts = title.split(/\s+\/\s+/);
    // Japanese uploads usually read "Title / Artist".
    if (slashParts.length === 2 && (!artist || normalizeForCompare(slashParts[1]).includes(normalizeForCompare(artist)))) {
      title = slashParts[0];
      artist = slashParts[1];
    }
  }

  title = tidy(title.replace(FEAT, ''));
  artist = tidy(artist.replace(FEAT, '').replace(ARTIST_SUFFIX, ''));
  return { title: title || rawTitle, artist, version };
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
