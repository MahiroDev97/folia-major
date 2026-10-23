import type { LyricData, SongResult } from '../types';
import { removeFromCache } from '../services/db';
import { LyricParserFactory } from './lyrics/LyricParserFactory';
import { resolveExplicitFileTimedLyricFormat } from './lyrics/formatDetection';
import { getOnlineLyricsStateCacheKey, loadOnlineLyricsState, resolveOnlineLyrics, saveOnlineLyricsState } from './onlineLyricsState';
import type { SmtcCleanTrack, SmtcSessionLike } from './smtcSession';

// src/utils/smtcLyricsOverride.ts
// Lyrics the user picked by hand for an SMTC track (an online match or an imported file),
// remembered per track. Stored through the same OnlineLyricsState cache online songs use, under
// a synthetic Stage song keyed by the raw title and artist Windows reports (not by the app), so
// the same video upload keeps its choice while a karaoke and the original stay separate.

export const smtcOverrideMediaId = (session: Pick<SmtcSessionLike, 'title' | 'artist'>): string => (
    `smtc:${session.title.trim()}|${session.artist.trim()}`
);

export function buildSmtcOverrideSong(session: SmtcSessionLike, track: SmtcCleanTrack): SongResult {
    return {
        id: -1,
        name: track.title,
        artists: [{ id: 0, name: track.artist }],
        album: { id: 0, name: session.album || '' },
        durationMs: Math.max(0, Math.floor(session.durationMs)),
        sourceType: 'cloud',
        isStage: true,
        sourceRef: { kind: 'stage', mediaId: smtcOverrideMediaId(session) },
    } as SongResult;
}

/** The lyrics the user chose for this track, or null when it still uses the automatic search. */
export async function loadSmtcOverrideLyrics(song: SongResult): Promise<LyricData | null> {
    try {
        return resolveOnlineLyrics(await loadOnlineLyricsState(song), null);
    } catch {
        return null;
    }
}

export async function importSmtcOverrideLyrics(song: SongResult, content: string, fileName: string): Promise<LyricData | null> {
    const importedLyrics = fileName.toLowerCase().endsWith('.txt')
        ? await LyricParserFactory.parse({ type: 'embedded', textContent: content })
        : await LyricParserFactory.parse({ type: 'local', lrcContent: content, formatHint: resolveExplicitFileTimedLyricFormat(fileName) });
    if (!importedLyrics?.lines.length) {
        return null;
    }
    const previous = await loadOnlineLyricsState(song);
    await saveOnlineLyricsState(song, {
        ...previous,
        lyricsSource: 'imported',
        importedLyrics,
        importedLyricsName: fileName,
    });
    return importedLyrics;
}

export async function clearSmtcOverrideLyrics(song: SongResult): Promise<void> {
    await removeFromCache(getOnlineLyricsStateCacheKey(song));
}
