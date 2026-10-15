import { useCallback, useEffect, useRef, useState } from 'react';
import type { LyricData } from '../types';
import type { WebLyricConnectionStatus, WebLyricSource, WebLyricSourceState } from '../types/webLyricSource';
import { initialWebLyricSourceState } from '../types/webLyricSource';
import { currentWebLyricTimeSec } from '../utils/webLyricSource';
import { autoMatchBestLyric } from '../utils/lyrics/autoMatchBestLyric';
import { fetchLrclibSyncedLyrics } from '../utils/lyrics/providers/lrclibProvider';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { detectNonTtmlTimedLyricFormat } from '../utils/lyrics/formatDetection';
import { getSongCoverUrl } from '../services/onlineMusic/songMetadata';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { useSmtcLyricsOverrideStore } from '../stores/useSmtcLyricsOverrideStore';
import { buildSmtcOverrideSong, loadSmtcOverrideLyrics } from '../utils/smtcLyricsOverride';
import {
  cleanSmtcTrack,
  isSpotifySmtcApp,
  pickActiveSmtcSession,
  smtcSessionClock,
  smtcTrackKey,
  type SmtcCleanTrack,
  type SmtcVersionKind,
  type SmtcSessionLike,
} from '../utils/smtcSession';

// src/hooks/useSmtcSource.ts
// SMTC Stage source: follows what Windows reports as playing (Spotify, YouTube in a browser, …)
// through the Electron main process, searches lyrics itself (Folia's providers first, LRCLIB as
// fallback) and exposes the same WebLyricSource shape as the PlayerCap / now-playing sources.

export interface SmtcSourceState extends WebLyricSourceState {
  activeAppId: string | null;
  lyricsLoading: boolean;
  /** The current lyrics are the original song's, shown for this karaoke / cover version. */
  lyricsVersion: SmtcVersionKind | null;
}

export interface SmtcSource extends WebLyricSource {
  state: SmtcSourceState;
}

interface SmtcLyricsResult {
  lyrics: LyricData | null;
  coverUrl: string | null;
  /** Set when the lyrics belong to the original song of a karaoke / cover version. */
  version: SmtcVersionKind | null;
}

const LYRIC_CACHE_LIMIT = 50;
const lyricCache = new Map<string, SmtcLyricsResult>();

const rememberLyrics = (key: string, result: SmtcLyricsResult) => {
  lyricCache.delete(key);
  lyricCache.set(key, result);
  if (lyricCache.size > LYRIC_CACHE_LIMIT) {
    lyricCache.delete(lyricCache.keys().next().value as string);
  }
};

const parseLrc = async (lrc: string): Promise<LyricData | null> => {
  try {
    return await LyricParserFactory.parse({ type: 'local', lrcContent: lrc, formatHint: detectNonTtmlTimedLyricFormat(lrc) } as never);
  } catch {
    return null;
  }
};

async function searchLyrics(track: SmtcCleanTrack, session: SmtcSessionLike): Promise<SmtcLyricsResult> {
  // A music video often runs longer than the song, and versions (karaoke, covers) differ from the
  // original, so in those cases durations are only a hint.
  const durationIsReliable = isSpotifySmtcApp(session.appId) && !track.version;
  const album = session.album || undefined;
  // A cover's or karaoke channel's "artist" is usually the uploader, not the original artist.
  const artists = track.version && track.artist ? [track.artist, ''] : [track.artist];
  const durations = durationIsReliable ? [session.durationMs] : [session.durationMs, 0];
  // Only a version's lyrics come from the original song; plain tracks report null.
  const version = track.version;

  const lrclibPromise = (async () => {
    for (const artist of artists) {
      const lrc = await fetchLrclibSyncedLyrics({
        title: track.title,
        artist,
        album: durationIsReliable ? album : undefined,
        durationMs: durationIsReliable ? session.durationMs : 0,
      });
      if (lrc) return lrc;
    }
    return null;
  })();

  const preferredSource = useLyricSettingsStore.getState().preferredAlternativeLyricSource;
  for (const artist of artists) {
    for (const durationMs of durations) {
      try {
        const match = await autoMatchBestLyric(track.title, artist, durationMs, { album, preferredSource });
        if (match && !match.isPureMusic && match.lyrics) {
          return { lyrics: match.lyrics, coverUrl: getSongCoverUrl(match.song) ?? null, version };
        }
        // An instrumental match is right for the original but not for a sung cover of it.
        if (match?.isPureMusic && !version) {
          return { lyrics: null, coverUrl: null, version: null };
        }
      } catch {
        // Provider unreachable: try the next attempt, then LRCLIB.
      }
    }
  }

  const lrc = await lrclibPromise;
  const lyrics = lrc ? await parseLrc(lrc) : null;
  return { lyrics, coverUrl: null, version: lyrics ? version : null };
}

const mapMonitorStatus = (status: ElectronSmtcStatus): WebLyricConnectionStatus => {
  switch (status) {
    case 'running': return 'connected';
    case 'starting': return 'connecting';
    case 'error':
    case 'unsupported': return 'error';
    default: return 'idle';
  }
};

const initialSmtcSourceState = (): SmtcSourceState => ({
  ...initialWebLyricSourceState(),
  activeAppId: null,
  lyricsLoading: false,
  lyricsVersion: null,
});

export function useSmtcSource({ enabled }: { enabled: boolean }): SmtcSource {
  const [state, setState] = useState<SmtcSourceState>(initialSmtcSourceState);
  const clockRef = useRef(state.clock);
  clockRef.current = state.clock;
  const trackKeyRef = useRef<string | null>(null);
  const lyricRequestIdRef = useRef(0);
  const currentTrackRef = useRef<{ key: string; track: SmtcCleanTrack; session: SmtcSessionLike } | null>(null);
  const reloadLyricsRef = useRef<(() => void) | null>(null);
  const overrideRevision = useSmtcLyricsOverrideStore(store => store.revision);

  useEffect(() => {
    const api = window.electron;
    if (!enabled || !api?.startSmtcMonitor || !api.onSmtcSnapshot) {
      setState(enabled ? { ...initialSmtcSourceState(), connectionStatus: 'error' } : initialSmtcSourceState());
      return undefined;
    }

    let disposed = false;
    trackKeyRef.current = null;

    const applyAutoLyrics = (key: string, track: SmtcCleanTrack, session: SmtcSessionLike, requestId: number) => {
      const cached = lyricCache.get(key);
      if (cached) {
        setState(s => ({ ...s, lyrics: cached.lyrics, lyricsVersion: cached.version, lyricsLoading: false, track: s.track && { ...s.track, coverUrl: cached.coverUrl } }));
        return;
      }

      void searchLyrics(track, session).then((result) => {
        rememberLyrics(key, result);
        if (disposed || lyricRequestIdRef.current !== requestId) return;
        setState(s => ({ ...s, lyrics: result.lyrics, lyricsVersion: result.version, lyricsLoading: false, track: s.track && { ...s.track, coverUrl: result.coverUrl } }));
      });
    };

    // Lyrics the user picked by hand for this track win over the automatic search.
    const loadLyrics = (key: string, track: SmtcCleanTrack, session: SmtcSessionLike) => {
      const requestId = lyricRequestIdRef.current + 1;
      lyricRequestIdRef.current = requestId;
      const overrideSong = buildSmtcOverrideSong(session, track);
      currentTrackRef.current = { key, track, session };
      useSmtcLyricsOverrideStore.getState().setSong(overrideSong, false);

      setState(s => ({ ...s, lyrics: null, lyricsVersion: null, lyricsLoading: true }));
      void loadSmtcOverrideLyrics(overrideSong).then((override) => {
        if (disposed || lyricRequestIdRef.current !== requestId) return;
        if (override) {
          useSmtcLyricsOverrideStore.getState().setSong(overrideSong, true);
          setState(s => ({ ...s, lyrics: override, lyricsVersion: null, lyricsLoading: false }));
          return;
        }
        applyAutoLyrics(key, track, session, requestId);
      });
    };
    reloadLyricsRef.current = () => {
      const current = currentTrackRef.current;
      if (current) loadLyrics(current.key, current.track, current.session);
    };

    const applySnapshot = (snapshot: ElectronSmtcSnapshot | null) => {
      if (disposed || !snapshot) return;
      const session = pickActiveSmtcSession(snapshot.sessions, snapshot.currentAppId);
      if (!session) {
        trackKeyRef.current = null;
        currentTrackRef.current = null;
        useSmtcLyricsOverrideStore.getState().setSong(null, false);
        lyricRequestIdRef.current += 1;
        setState(s => ({ ...initialSmtcSourceState(), connectionStatus: s.connectionStatus }));
        return;
      }

      const key = smtcTrackKey(session);
      const track = cleanSmtcTrack(session);
      const clock = smtcSessionClock(session, Date.now());
      const isNewTrack = key !== trackKeyRef.current;
      trackKeyRef.current = key;

      setState(s => ({
        ...s,
        activeAppId: session.appId,
        playerState: clock.playing ? 'playing' : 'paused',
        clock,
        track: isNewTrack || !s.track
          ? { name: track.title, artist: track.artist, coverUrl: null, seed: key }
          : s.track,
      }));

      if (isNewTrack) {
        loadLyrics(key, track, session);
      }
    };

    const offSnapshot = api.onSmtcSnapshot(applySnapshot);
    const offStatus = api.onSmtcStatusChanged?.(status => {
      if (!disposed) setState(s => ({ ...s, connectionStatus: mapMonitorStatus(status) }));
    });

    setState(s => ({ ...s, connectionStatus: 'connecting' }));
    void api.startSmtcMonitor().then(({ status, snapshot }) => {
      if (disposed) return;
      setState(s => ({ ...s, connectionStatus: mapMonitorStatus(status) }));
      applySnapshot(snapshot);
    }).catch(() => {
      if (!disposed) setState(s => ({ ...s, connectionStatus: 'error' }));
    });

    return () => {
      disposed = true;
      lyricRequestIdRef.current += 1;
      reloadLyricsRef.current = null;
      currentTrackRef.current = null;
      useSmtcLyricsOverrideStore.getState().setSong(null, false);
      offSnapshot();
      offStatus?.();
      void api.stopSmtcMonitor?.();
    };
  }, [enabled]);

  // A choice was saved or cleared from the lyric dialogs: reload the current track.
  useEffect(() => {
    if (overrideRevision > 0) reloadLyricsRef.current?.();
  }, [overrideRevision]);

  const getCurrentTimeSec = useCallback((nowMs: number) => currentWebLyricTimeSec(clockRef.current, nowMs), []);

  return { state, getCurrentTimeSec };
}
