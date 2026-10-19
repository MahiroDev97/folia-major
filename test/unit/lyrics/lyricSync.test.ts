import { describe, expect, it } from 'vitest';
import { parseEnhancedLRC } from '@/utils/lyrics/parserCore';
import { buildSyncedLyrics, quantizeTaps, shiftTaps, splitLineWords, splitLyricText, syncedLyricsToLrc, tapTarget, tapsNeeded } from '@/utils/lyrics/lyricSync';

const LYRICS = 'Corazón de neón\n\n  Every   word is a knife \nNo me sueltes';

describe('lyricSync', () => {
  it('splits pasted lyrics and words', () => {
    const lines = splitLyricText(LYRICS);
    expect(lines).toEqual(['Corazón de neón', 'Every word is a knife', 'No me sueltes']);
    expect(splitLineWords(lines[1])).toEqual(['Every ', 'word ', 'is ', 'a ', 'knife']);
  });

  it('counts taps and finds the tap target', () => {
    const lines = splitLyricText(LYRICS);
    expect(tapsNeeded(lines, 'line')).toBe(3);
    expect(tapsNeeded(lines, 'word')).toBe(11);
    expect(tapTarget(lines, 'word', 3)).toEqual({ line: 1, word: 0 });
    expect(tapTarget(lines, 'word', 11)).toBeNull();
  });

  it('builds line lyrics that end where the next line starts', () => {
    const lyrics = buildSyncedLyrics(splitLyricText(LYRICS), [1, 4, 7.5], 'line', 9);
    expect(lyrics.lines.map(l => [l.startTime, l.endTime])).toEqual([[1, 3.95], [4, 7.45], [7.5, 9]]);
    expect(lyrics.isWordByWord).toBe(false);
  });

  it('keeps only fully tapped lines in a partial word sync', () => {
    const lyrics = buildSyncedLyrics(splitLyricText(LYRICS), [1, 1.5, 2, 4, 4.3], 'word');
    expect(lyrics.lines).toHaveLength(1);
    expect(lyrics.lines[0].words.map(w => w.startTime)).toEqual([1, 1.5, 2]);
  });

  it('round-trips through LRC and Folia’s parser', () => {
    const lines = splitLyricText(LYRICS);
    const taps = [1, 1.4, 2, 4, 4.3, 4.6, 4.8, 5, 7.5, 7.9, 8.2];
    const lrc = syncedLyricsToLrc(buildSyncedLyrics(lines, taps, 'word', 10), 'word', { title: 'Demo' });
    expect(lrc).toContain('[00:04.00]');
    expect(lrc).toContain('<00:04.300>');
    const parsed = parseEnhancedLRC(lrc);
    expect(parsed?.lines.map(l => l.fullText.trim())).toEqual(lines);
    expect(parsed?.lines[1].startTime).toBeCloseTo(4, 2);
  });

  it('shifts every tap without going negative', () => {
    expect(shiftTaps([0.05, 1, 2.5], -0.1)).toEqual([0, 0.9, 2.4]);
  });
});

describe('quantizeTaps', () => {
  const beat = 60 / 195;
  it('snaps loose taps onto a 195 BPM eighth-note grid found from the taps', () => {
    const exact = [8, 13, 21, 30].map(n => n * beat / 2);
    const loose = exact.map((t, i) => t + [0.04, -0.05, 0.03, -0.02][i]);
    // Estimating the grid from four taps is good to well under what the ear notices (~30 ms).
    quantizeTaps(loose, 195, 2).forEach((t, i) => expect(Math.abs(t - exact[i])).toBeLessThan(.02));
  });
  it('uses an explicit first-beat phase when given', () => {
    expect(quantizeTaps([1.0], 195, 1, 0.1)[0]).toBeCloseTo(0.1 + 3 * beat, 3);
  });
  it('never lets two taps collapse onto the same step', () => {
    const out = quantizeTaps([1.0, 1.02], 195, 2, 0);
    expect(out[1]).toBeGreaterThan(out[0]);
  });
});
