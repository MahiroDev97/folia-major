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
import {
  cleanSmtcTrack,
  isSpotifySmtcApp,
  pickActiveSmtcSession,
  smtcSessionClock,
  smtcTrackKey,
  type SmtcCleanTrack,
  type SmtcSessionLike,
} from '../utils/smtcSession';

// src/hooks/useSmtcSource.ts
// SMTC Stage source: follows what Windows reports as playing (Spotify, YouTube in a browser, …)
// through the Electron main process, searches lyrics itself (Folia's providers first, LRCLIB as
// fallback) and exposes the same WebLyricSource shape as the PlayerCap / now-playing sources.

export interface SmtcSourceState extends WebLyricSourceState {
  activeAppId: string | null;
  lyricsLoading: boolean;
}

export interface SmtcSource extends WebLyricSource {
  state: SmtcSourceState;
}

interface SmtcLyricsResult {
  lyrics: LyricData | null;
  coverUrl: string | null;
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
  // A music video often runs longer than the song, so browser durations are only a hint.
  const durationIsReliable = isSpotifySmtcApp(session.appId);
  const album = session.album || undefined;
  const lrclibPromise = fetchLrclibSyncedLyrics({
    title: track.title,
    artist: track.artist,
    album: durationIsReliable ? album : undefined,
    durationMs: durationIsReliable ? session.durationMs : 0,
  });

  const preferredSource = useLyricSettingsStore.getState().preferredAlternativeLyricSource;
  const attempts = durationIsReliable ? [session.durationMs] : [session.durationMs, 0];
  for (const durationMs of attempts) {
    try {
      const match = await autoMatchBestLyric(track.title, track.artist, durationMs, { album, preferredSource });
      if (match && !match.isPureMusic && match.lyrics) {
        return { lyrics: match.lyrics, coverUrl: getSongCoverUrl(match.song) ?? null };
      }
      if (match?.isPureMusic) {
        return { lyrics: null, coverUrl: null };
      }
    } catch {
      // Provider unreachable: try the next attempt, then LRCLIB.
    }
  }

  const lrc = await lrclibPromise;
  return { lyrics: lrc ? await parseLrc(lrc) : null, coverUrl: null };
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
});

export function useSmtcSource({ enabled }: { enabled: boolean }): SmtcSource {
  const [state, setState] = useState<SmtcSourceState>(initialSmtcSourceState);
  const clockRef = useRef(state.clock);
  clockRef.current = state.clock;
  const trackKeyRef = useRef<string | null>(null);
  const lyricRequestIdRef = useRef(0);

  useEffect(() => {
    const api = window.electron;
    if (!enabled || !api?.startSmtcMonitor || !api.onSmtcSnapshot) {
      setState(enabled ? { ...initialSmtcSourceState(), connectionStatus: 'error' } : initialSmtcSourceState());
      return undefined;
    }

    let disposed = false;
    trackKeyRef.current = null;

    const loadLyrics = (key: string, track: SmtcCleanTrack, session: SmtcSessionLike) => {
      const requestId = lyricRequestIdRef.current + 1;
      lyricRequestIdRef.current = requestId;
      const cached = lyricCache.get(key);
      if (cached) {
        setState(s => ({ ...s, lyrics: cached.lyrics, lyricsLoading: false, track: s.track && { ...s.track, coverUrl: cached.coverUrl } }));
        return;
      }

      setState(s => ({ ...s, lyrics: null, lyricsLoading: true }));
      void searchLyrics(track, session).then((result) => {
        rememberLyrics(key, result);
        if (disposed || lyricRequestIdRef.current !== requestId) return;
        setState(s => ({ ...s, lyrics: result.lyrics, lyricsLoading: false, track: s.track && { ...s.track, coverUrl: result.coverUrl } }));
      });
    };

    const applySnapshot = (snapshot: ElectronSmtcSnapshot | null) => {
      if (disposed || !snapshot) return;
      const session = pickActiveSmtcSession(snapshot.sessions, snapshot.currentAppId);
      if (!session) {
        trackKeyRef.current = null;
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
      offSnapshot();
      offStatus?.();
      void api.stopSmtcMonitor?.();
    };
  }, [enabled]);

  const getCurrentTimeSec = useCallback((nowMs: number) => currentWebLyricTimeSec(clockRef.current, nowMs), []);

  return { state, getCurrentTimeSec };
}
