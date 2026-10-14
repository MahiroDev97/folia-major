// src/utils/lyrics/providers/lrclibProvider.ts
// LRCLIB (https://lrclib.net): free, keyless, community synced lyrics with good coverage of Western
// and Latin music. Returns the raw synced LRC text; callers parse it like any local LRC.
// The API asks clients to identify themselves and to back off on 429/503, so failures return null.

const LRCLIB_API = 'https://lrclib.net/api';
const LRCLIB_CLIENT = 'Folia (local fork)';
const REQUEST_TIMEOUT_MS = 6000;
// /api/get itself matches durations within ±2 s; search results get a little more slack.
const SEARCH_DURATION_TOLERANCE_SEC = 3;

interface LrclibRecord {
  id: number;
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
}

export interface LrclibQuery {
  title: string;
  artist: string;
  album?: string;
  /** Leave out (0) when the duration is unreliable, e.g. a music video with an intro. */
  durationMs?: number;
}

async function requestJson<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetch(`${LRCLIB_API}${path}?${new URLSearchParams(params)}`, {
      headers: { 'Lrclib-Client': LRCLIB_CLIENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

const hasSyncedLyrics = (record: LrclibRecord | null | undefined): record is LrclibRecord & { syncedLyrics: string } => (
  Boolean(record && !record.instrumental && typeof record.syncedLyrics === 'string' && record.syncedLyrics.trim())
);

export async function fetchLrclibSyncedLyrics(query: LrclibQuery, signal?: AbortSignal): Promise<string | null> {
  const title = query.title.trim();
  const artist = query.artist.trim();
  if (!title) {
    return null;
  }

  const durationSec = query.durationMs && query.durationMs > 0 ? Math.round(query.durationMs / 1000) : 0;

  if (artist) {
    const exact = await requestJson<LrclibRecord>('/get', {
      track_name: title,
      artist_name: artist,
      ...(query.album ? { album_name: query.album } : {}),
      ...(durationSec ? { duration: String(durationSec) } : {}),
    }, signal);
    if (hasSyncedLyrics(exact)) {
      return exact.syncedLyrics;
    }
  }

  const results = await requestJson<LrclibRecord[]>('/search', {
    track_name: title,
    ...(artist ? { artist_name: artist } : {}),
  }, signal);
  if (!Array.isArray(results)) {
    return null;
  }

  const synced = results.filter(hasSyncedLyrics);
  const best = durationSec
    ? synced.find(record => Math.abs((record.duration ?? 0) - durationSec) <= SEARCH_DURATION_TOLERANCE_SEC) ?? synced[0]
    : synced[0];
  return best?.syncedLyrics ?? null;
}
