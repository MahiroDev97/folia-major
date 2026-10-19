import type { LyricData, Line } from '../../types';
import { serializeEnhancedLrc } from './enhancedLrcSerializer';

// src/utils/lyrics/lyricSync.ts
// Tap-to-sync for local songs: the user pastes plain lyrics, plays the song and taps at the start of
// each line (or each word). These helpers turn the taps into LyricData and enhanced LRC text.

export type LyricSyncMode = 'line' | 'word';

/** Non-empty, trimmed lines of pasted lyrics. Blank lines (verse breaks) are dropped. */
export const splitLyricText = (text: string): string[] => text
  .split(/\r?\n/)
  .map(line => line.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

/** Words of a line as they are tapped: split on spaces, keeping each word's trailing space. */
export const splitLineWords = (line: string): string[] => {
  const words = line.split(' ').filter(Boolean);
  return words.map((word, index) => (index < words.length - 1 ? word + ' ' : word));
};

/** How many taps a full sync needs. */
export const tapsNeeded = (lines: string[], mode: LyricSyncMode): number => (
  mode === 'line' ? lines.length : lines.reduce((total, line) => total + splitLineWords(line).length, 0)
);

/** Line and word index of tap number `tapIndex` (0-based). */
export const tapTarget = (lines: string[], mode: LyricSyncMode, tapIndex: number): { line: number; word: number } | null => {
  if (tapIndex < 0) return null;
  if (mode === 'line') return tapIndex < lines.length ? { line: tapIndex, word: 0 } : null;
  let remaining = tapIndex;
  for (let line = 0; line < lines.length; line++) {
    const count = splitLineWords(lines[line]).length;
    if (remaining < count) return { line, word: remaining };
    remaining -= count;
  }
  return null;
};

// A line with nothing after it keeps the screen for a while, but never past the song.
const LAST_LINE_SECONDS = 5;
const GAP = .05;

/**
 * Builds LyricData from taps. `taps` are seconds, in tap order (one per line, or one per word).
 * Only fully tapped lines are included, so a partial sync still produces valid lyrics.
 */
export function buildSyncedLyrics(lines: string[], taps: number[], mode: LyricSyncMode, songDuration = 0): LyricData {
  const starts: number[][] = [];
  let cursor = 0;
  for (const line of lines) {
    const need = mode === 'line' ? 1 : splitLineWords(line).length;
    if (cursor + need > taps.length) break;
    starts.push(taps.slice(cursor, cursor + need));
    cursor += need;
  }
  const out: Line[] = starts.map((wordStarts, index) => {
    const text = lines[index];
    const startTime = wordStarts[0];
    const nextStart = starts[index + 1]?.[0];
    const fallbackEnd = songDuration > startTime ? Math.min(songDuration, startTime + LAST_LINE_SECONDS) : startTime + LAST_LINE_SECONDS;
    const endTime = Math.max(startTime + .2, nextStart !== undefined ? nextStart - GAP : fallbackEnd);
    const words = mode === 'line'
      ? [{ text, startTime, endTime }]
      : splitLineWords(text).map((word, w) => ({
        text: word,
        startTime: wordStarts[w],
        endTime: Math.max(wordStarts[w] + .05, w + 1 < wordStarts.length ? wordStarts[w + 1] : endTime),
      }));
    return { words, startTime, endTime, fullText: text };
  });
  return { lines: out, isWordByWord: mode === 'word' };
}

/** Moves every tap by `seconds` (never below zero). */
export const shiftTaps = (taps: number[], seconds: number): number[] => taps.map(t => Math.max(0, +(t + seconds).toFixed(3)));

/** Enhanced LRC text for the synced lyrics (word tags only in word mode). */
export const syncedLyricsToLrc = (lyrics: LyricData, mode: LyricSyncMode, metadata: { title?: string; artist?: string } = {}): string => (
  serializeEnhancedLrc(lyrics, { metadata, includeTranslation: false, includeRomanization: false, wordTiming: mode === 'word' ? 'word' : 'line' })
);

/**
 * Snaps taps to the rhythmic grid of a song with a known BPM. `division` is how many grid steps
 * per beat (1 quarter, 2 eighth, 4 sixteenth). The grid's offset comes from the taps themselves
 * (their circular mean on one grid step), since taps made by ear cluster around the real grid; an
 * explicit `phase` (seconds of the first beat) overrides it. Taps keep their order.
 */
export function quantizeTaps(taps: number[], bpm: number, division = 2, phase?: number): number[] {
  if (!taps.length || !(bpm > 0) || !(division > 0)) return [...taps];
  const step = 60 / bpm / division;
  let offset = phase;
  if (offset === undefined) {
    let x = 0, y = 0;
    for (const t of taps) { const a = (t / step) * 2 * Math.PI; x += Math.cos(a); y += Math.sin(a); }
    offset = ((Math.atan2(y, x) / (2 * Math.PI)) * step + step) % step;
  }
  const snapped: number[] = [];
  for (const t of taps) {
    let value = offset + Math.round((t - offset) / step) * step;
    const previous = snapped[snapped.length - 1];
    // Two taps that land on the same grid step keep their order one step apart.
    if (previous !== undefined && value <= previous) value = previous + step;
    snapped.push(Math.max(0, +value.toFixed(3)));
  }
  return snapped;
}
