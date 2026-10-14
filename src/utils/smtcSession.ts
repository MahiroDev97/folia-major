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

export interface SmtcCleanTrack {
  title: string;
  artist: string;
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

// Spotify already publishes clean title/artist. Browsers publish the video title and the channel
// name, e.g. "DECO*27 - ボルテッカー feat. 初音ミク" by "DECO*27", or "Despacito" by "Luis Fonsi - Topic".
export function cleanSmtcTrack(session: Pick<SmtcSessionLike, 'appId' | 'title' | 'artist'>): SmtcCleanTrack {
  const rawTitle = session.title.trim();
  const rawArtist = session.artist.trim();
  if (isSpotifySmtcApp(session.appId)) {
    return { title: rawTitle, artist: rawArtist };
  }

  let title = stripNoiseGroups(rawTitle).split(/\s+\|\s+/)[0];
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
  return { title: title || rawTitle, artist };
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
