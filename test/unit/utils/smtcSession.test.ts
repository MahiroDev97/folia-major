import { describe, expect, it } from 'vitest';
import { cleanSmtcTrack, pickActiveSmtcSession, smtcSessionClock, type SmtcSessionLike } from '@/utils/smtcSession';
import { currentWebLyricTimeSec } from '@/utils/webLyricSource';

const SPOTIFY = 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify';

const session = (overrides: Partial<SmtcSessionLike>): SmtcSessionLike => ({
  appId: 'Brave',
  title: 'Song',
  artist: 'Artist',
  album: '',
  status: 'playing',
  positionMs: 0,
  durationMs: 200_000,
  updatedAtMs: 1_000,
  ...overrides,
});

describe('cleanSmtcTrack', () => {
  it.each([
    ['DECO*27 - ボルテッカー feat. 初音ミク', 'DECO*27', 'ボルテッカー', 'DECO*27'],
    ['Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO', 'Despacito', 'Luis Fonsi'],
    ['Bad Bunny - DtMF (Visualizer)', 'Bad Bunny', 'DtMF', 'Bad Bunny'],
    ['Despacito', 'Luis Fonsi - Topic', 'Despacito', 'Luis Fonsi'],
    ['【MV】マーシャル・マキシマイザー / 柊マグネタイト', '柊マグネタイト', 'マーシャル・マキシマイザー', '柊マグネタイト'],
    ['Shakira - Hips Don\'t Lie (Official 4K Video) ft. Wyclef Jean', 'shakiraVEVO', 'Hips Don\'t Lie', 'Shakira'],
    ['Soda Stereo - De Música Ligera (En Vivo) | Me Verás Volver', 'Soda Stereo', 'De Música Ligera', 'Soda Stereo'],
  ])('cleans %s by %s', (title, artist, expectedTitle, expectedArtist) => {
    expect(cleanSmtcTrack({ appId: 'Brave', title, artist })).toEqual({ title: expectedTitle, artist: expectedArtist });
  });

  it('keeps brackets that are part of the song title', () => {
    expect(cleanSmtcTrack({ appId: 'chrome', title: 'Artist - Song (Remix 2)', artist: 'Artist' }).title).toBe('Song (Remix 2)');
  });

  it('trusts Spotify metadata as published', () => {
    expect(cleanSmtcTrack({ appId: SPOTIFY, title: 'Title - 2011 Remaster', artist: 'Band' }))
      .toEqual({ title: 'Title - 2011 Remaster', artist: 'Band' });
  });
});

describe('pickActiveSmtcSession', () => {
  it('prefers the most recently updated playing session', () => {
    const picked = pickActiveSmtcSession([
      session({ appId: SPOTIFY, status: 'playing', updatedAtMs: 100 }),
      session({ appId: 'Brave', status: 'playing', updatedAtMs: 200 }),
      session({ appId: 'Edge', status: 'paused', updatedAtMs: 300 }),
    ], SPOTIFY);
    expect(picked?.appId).toBe('Brave');
  });

  it('falls back to the current session when nothing plays', () => {
    const picked = pickActiveSmtcSession([
      session({ appId: SPOTIFY, status: 'paused', updatedAtMs: 100 }),
      session({ appId: 'Brave', status: 'paused', updatedAtMs: 200 }),
    ], SPOTIFY);
    expect(picked?.appId).toBe(SPOTIFY);
  });

  it('ignores sessions without a title', () => {
    expect(pickActiveSmtcSession([session({ title: '  ' })], null)).toBeNull();
  });
});

describe('smtcSessionClock', () => {
  it('anchors at the time Windows measured the position', () => {
    const clock = smtcSessionClock(session({ positionMs: 110, updatedAtMs: 15_000 }), 38_000);
    // Earlier probe: YouTube reported 0.11 s measured 23 s before it was read.
    expect(currentWebLyricTimeSec(clock, 38_000)).toBeCloseTo(23.11, 2);
  });

  it('freezes while paused', () => {
    const clock = smtcSessionClock(session({ status: 'paused', positionMs: 108_463, updatedAtMs: 1_000 }), 60_000);
    expect(currentWebLyricTimeSec(clock, 60_000)).toBeCloseTo(108.463, 3);
  });

  it('never anchors in the future', () => {
    const clock = smtcSessionClock(session({ positionMs: 5_000, updatedAtMs: 10_000 }), 9_000);
    expect(clock.anchoredAtMs).toBe(9_000);
  });
});
