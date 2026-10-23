import i18n from '../i18n/config';
import { setLyricTimelineOffsetMs, usePlaybackStore } from '../stores/usePlaybackStore';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { writeLyricOffset } from './lyrics/lyricOffsetMemory';

// src/utils/smtcLyricOffset.ts
// Quick lyric sync for the SMTC source in Stage, from the command palette. A karaoke or cover
// rarely shares the original's intro, so its lyrics run early or late by a few seconds. This edits
// the same per-song offset the player panel control does, and Stage songs have a stable id per
// upload, so the correction comes back the next time that video or track plays.

const OFFSET_LIMIT_MS = 30_000;

/** Shift the current song's lyrics by `deltaMs` (positive: later), or reset them with `null`. */
export function nudgeStageLyricOffset(deltaMs: number | null): void {
    const { lyricTimelineOffsetMs, currentSong } = usePlaybackStore.getState();
    const next = deltaMs === null
        ? 0
        : Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, lyricTimelineOffsetMs + deltaMs));
    setLyricTimelineOffsetMs(next);
    writeLyricOffset(currentSong?.id, next);
    setStatusMessage({
        type: 'info',
        text: next === 0
            ? i18n.t('status.smtcLyricOffsetReset')
            : i18n.t('status.smtcLyricOffset', { seconds: `${next > 0 ? '+' : ''}${(next / 1000).toFixed(1)}` }),
    });
}
