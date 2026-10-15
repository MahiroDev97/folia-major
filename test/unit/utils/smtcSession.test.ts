import { describe, expect, it } from 'vitest';
import { cleanSmtcTrack, lyricsScriptFitsTrack, pickActiveSmtcSession, smtcSessionClock, stableStageSongId, type SmtcSessionLike } from '@/utils/smtcSession';
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
    ['Soda Stereo - De Música Ligera (En Vivo)', 'Soda Stereo', 'De Música Ligera', 'Soda Stereo'],
  ])('cleans %s by %s', (title, artist, expectedTitle, expectedArtist) => {
    expect(cleanSmtcTrack({ appId: 'Brave', title, artist })).toEqual({ title: expectedTitle, artist: expectedArtist, version: null });
  });

  it('keeps brackets that are part of the song title', () => {
    expect(cleanSmtcTrack({ appId: 'chrome', title: 'Artist - Song (Remix 2)', artist: 'Artist' }).title).toBe('Song (Remix 2)');
  });

  it('trusts Spotify metadata as published', () => {
    expect(cleanSmtcTrack({ appId: SPOTIFY, title: 'Title - 2011 Remaster', artist: 'Band' }))
      .toEqual({ title: 'Title - 2011 Remaster', artist: 'Band', version: null });
  });
});

describe('cleanSmtcTrack versions', () => {
  it.each([
    ['Ed Sheeran - Perfect (Karaoke Version)', 'Sing King', 'Perfect', 'Ed Sheeran', 'karaoke'],
    ['Bohemian Rhapsody - Karaoke Version', 'Queen Karaoke', 'Bohemian Rhapsody', 'Queen Karaoke', 'karaoke'],
    ['YOASOBI - アイドル (Instrumental)', 'YOASOBI', 'アイドル', 'YOASOBI', 'instrumental'],
    ['【歌ってみた】ボルテッカー / 歌い手ちゃん', '歌い手ちゃん', 'ボルテッカー', '歌い手ちゃん', 'cover'],
    ['Bad Apple!! (Versión en Español)', 'Fandubber', 'Bad Apple!!', 'Fandubber', 'foreign'],
    ['Idol - Spanish Cover', 'Cantante', 'Idol', 'Cantante', 'foreign'],
    ['Perfect (Cover by Fulana)', 'Fulana', 'Perfect', 'Fulana', 'cover'],
  ])('detects %s', (title, artist, expectedTitle, expectedArtist, version) => {
    expect(cleanSmtcTrack({ appId: 'Brave', title, artist })).toMatchObject({ title: expectedTitle, artist: expectedArtist, version });
  });

  // Real uploads that went wrong: the title hidden in 『』, a leading 【】 tag, "Song - Artist" order.
  it.each([
    ['『Anytime Anywhere FULL ESPAÑOL』Sousou no Frieren Ending Cover | Milet『 @Beth Rodríguez 』♡', 'Beth Rodríguez', 'Anytime Anywhere', 'foreign'],
    ['【Kasane Teto SV2】In the End [SynthV Cover]', 'ararix', 'In the End', 'cover'],
    ['Aishite Aishite Aishite - Kikuo', 'Kikuo', 'Aishite Aishite Aishite', null],
    ['BIRDBRAIN - JamieP', 'JamieP', 'BIRDBRAIN', null],
  ])('reads %s', (title, artist, expectedTitle, version) => {
    expect(cleanSmtcTrack({ appId: 'Brave', title, artist })).toMatchObject({ title: expectedTitle, version });
  });

  it('offers the other reading when neither side is the channel', () => {
    expect(cleanSmtcTrack({ appId: 'Brave', title: 'Ed Sheeran - Perfect (Karaoke Version)', artist: 'Sing King' })).toEqual({
      title: 'Perfect', artist: 'Ed Sheeran', version: 'karaoke', swapped: { title: 'Ed Sheeran', artist: 'Perfect' },
    });
  });

  it('reads a bilingual title as the title', () => {
    expect(cleanSmtcTrack({ appId: 'Brave', title: '【Off-Vocal Karaoke】Yararara / ヤラララ - ABM [Kanji & Romaji]', artist: 'Kara-P' })).toEqual({
      title: 'Yararara', artist: 'ABM', version: 'karaoke', swapped: { title: 'ヤラララ', artist: 'ABM' },
    });
  });

  it('ignores a quote that only holds a tag', () => {
    expect(cleanSmtcTrack({ appId: 'Brave', title: '「KARAOKE」Igaku / Medicine (English Cover) - Kasane Teto SV - Off Vocal', artist: 'Pokelfig studio' })).toEqual({
      title: 'Igaku', artist: 'Kasane Teto SV', version: 'foreign', swapped: { title: 'Medicine', artist: 'Kasane Teto SV' },
    });
  });

  it('keeps the other "|" segments as a context hint', () => {
    expect(cleanSmtcTrack({ appId: 'Brave', title: 'Mi Reflejo | Mulán | Karaoke 🌸 🍃', artist: 'Miss Disney' })).toEqual({
      title: 'Mi Reflejo', artist: 'Miss Disney', version: 'karaoke', context: 'Mulán',
    });
  });

  it('uses a live album after "|" as the hint', () => {
    expect(cleanSmtcTrack({ appId: 'Brave', title: 'Soda Stereo - De Música Ligera (En Vivo) | Me Verás Volver', artist: 'Soda Stereo' }))
      .toEqual({ title: 'De Música Ligera', artist: 'Soda Stereo', version: null, context: 'Me Verás Volver' });
  });

  it('trusts the side that matches the channel', () => {
    expect(cleanSmtcTrack({ appId: 'Brave', title: 'Aishite Aishite Aishite - Kikuo', artist: 'Kikuo' }).swapped).toBeUndefined();
  });

  it('strips version tags from Spotify titles too', () => {
    expect(cleanSmtcTrack({ appId: SPOTIFY, title: 'Shape of You - Instrumental', artist: 'Karaoke Band' }))
      .toEqual({ title: 'Shape of You', artist: 'Karaoke Band', version: 'instrumental' });
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

describe('lyricsScriptFitsTrack', () => {
  const russian = 'Ярарара, и досада душу рвёт Ярарара на исходе';
  it('rejects a Russian cover for a Japanese karaoke', () => {
    expect(lyricsScriptFitsTrack(russian, { version: 'karaoke' }, 'Yararara ヤラララ ABM')).toBe(false);
  });
  it('accepts Japanese lyrics for the same song', () => {
    expect(lyricsScriptFitsTrack('ヤラララ 心を揺らす', { version: 'karaoke' }, 'Yararara ヤラララ ABM')).toBe(true);
  });
  it('leaves plain Latin-titled tracks alone (K-pop)', () => {
    expect(lyricsScriptFitsTrack('봄날 보고 싶다 이렇게 말하니까', { version: null }, 'Spring Day BTS')).toBe(true);
  });
  it('accepts the script the title itself uses', () => {
    expect(lyricsScriptFitsTrack(russian, { version: 'cover' }, 'Ярарара Kara-P')).toBe(true);
  });
});

describe('stableStageSongId', () => {
  it('gives the same upload the same id, clear of other Stage ids', () => {
    const seed = 'Brave|Mi Reflejo | Mulán | Karaoke|Miss Disney';
    expect(stableStageSongId(seed)).toBe(stableStageSongId(seed));
    expect(stableStageSongId(seed)).toBeLessThan(-999_999);
    expect(stableStageSongId(seed)).not.toBe(stableStageSongId('Brave|Mi Reflejo|Christina Aguilera'));
  });
});
