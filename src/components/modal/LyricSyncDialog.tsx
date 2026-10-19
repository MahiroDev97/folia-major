import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalSong } from '../../types';
import { useLyricSyncStore } from '../../stores/useLyricSyncStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import {
    buildSyncedLyrics,
    quantizeTaps,
    shiftTaps,
    splitLineWords,
    splitLyricText,
    syncedLyricsToLrc,
    tapTarget,
    tapsNeeded,
    type LyricSyncMode,
} from '../../utils/lyrics/lyricSync';
import { sidecarLyricFileName, writeLocalLyricSidecar } from '../../services/localLyricSidecar';
import { triggerBlobDownload } from '../../services/lyricExport/lyricExportFiles';

// src/components/modal/LyricSyncDialog.tsx
// Tap-to-sync lyric editor for the current local song: paste lyrics, tap Space at the start of each
// line (or word) while the song plays, review and fine-tune, then save into Folia and optionally as a
// .lrc next to the audio file. Reads the real <audio> clock for tap accuracy.

type Stage = 'text' | 'tap' | 'review';

interface LyricSyncDialogProps {
    audioRef: RefObject<HTMLAudioElement | null>;
    getLocalSong: () => LocalSong | null;
    onSave: (content: string, fileName: string) => Promise<void> | void;
}

const formatTime = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const m = Math.floor(safe / 60);
    const s = safe - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

const LyricSyncDialog: React.FC<LyricSyncDialogProps> = ({ audioRef, getLocalSong, onSave }) => {
    const { t } = useTranslation();
    const open = useLyricSyncStore(state => state.open);
    const closeSync = useLyricSyncStore(state => state.closeSync);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const [stage, setStage] = useState<Stage>('text');
    const [text, setText] = useState('');
    const [mode, setMode] = useState<LyricSyncMode>('line');
    const [taps, setTaps] = useState<number[]>([]);
    const [now, setNow] = useState(0);
    const [paused, setPaused] = useState(true);
    const [saveSidecar, setSaveSidecar] = useState(true);
    const [saving, setSaving] = useState(false);
    const [bpm, setBpm] = useState('');
    const [division, setDivision] = useState(2);
    const [beforeSnap, setBeforeSnap] = useState<number[] | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);

    const lines = useMemo(() => splitLyricText(text), [text]);
    const total = useMemo(() => tapsNeeded(lines, mode), [lines, mode]);
    const song = open ? getLocalSong() : null;
    const artist = usePlaybackStore(state => state.currentSong?.artists?.[0]?.name) || '';

    // Fresh state each time the dialog opens; the current lyrics (if any) prefill the text box.
    useEffect(() => {
        if (!open) return;
        const current = usePlaybackStore.getState().lyrics?.lines.map(line => line.fullText.trim()).filter(Boolean) ?? [];
        setText(current.join('\n'));
        setStage('text'); setTaps([]); setSaving(false); setBeforeSnap(null);
    }, [open]);

    // Follow the real audio clock while open.
    useEffect(() => {
        if (!open) return undefined;
        let frame = 0;
        const loop = () => {
            const audio = audioRef.current;
            if (audio) { setNow(audio.currentTime); setPaused(audio.paused); }
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [audioRef, open]);

    const seek = useCallback((seconds: number, play?: boolean) => {
        const audio = audioRef.current; if (!audio) return;
        audio.currentTime = Math.max(0, Math.min(Number.isFinite(audio.duration) ? audio.duration : seconds, seconds));
        if (play) void audio.play().catch(() => {});
    }, [audioRef]);
    const togglePlay = useCallback(() => {
        const audio = audioRef.current; if (!audio) return;
        if (audio.paused) void audio.play().catch(() => {}); else audio.pause();
    }, [audioRef]);

    const tap = useCallback(() => {
        const audio = audioRef.current; if (!audio) return;
        setTaps(current => {
            if (current.length >= total) return current;
            const time = +audio.currentTime.toFixed(3);
            // Taps never go backwards: a tap before the previous one would invert two lines.
            const previous = current[current.length - 1] ?? -1;
            const next = [...current, Math.max(time, previous + .01)];
            if (next.length >= total) setStage('review');
            return next;
        });
    }, [audioRef, total]);
    const undo = useCallback(() => setTaps(current => current.slice(0, -1)), []);

    // Keyboard: captured before the app's own shortcuts while the dialog is open.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeSync(); return; }
            if (stage === 'text') return;
            const key = event.key.toLowerCase();
            let handled = true;
            if (stage === 'tap' && (key === ' ' || key === 'enter')) tap();
            else if (stage === 'tap' && key === 'backspace') undo();
            else if (key === 'arrowleft') seek((audioRef.current?.currentTime ?? 0) - 3);
            else if (key === 'arrowright') seek((audioRef.current?.currentTime ?? 0) + 3);
            else if (key === 'p' || (stage === 'review' && key === ' ')) togglePlay();
            else handled = false;
            if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [audioRef, closeSync, open, seek, stage, tap, togglePlay, undo]);

    // Index of the first tap of each line (word mode taps several per line).
    const lineTapStart = useMemo(() => {
        const starts: number[] = []; let cursor = 0;
        for (const line of lines) { starts.push(cursor); cursor += mode === 'line' ? 1 : splitLineWords(line).length; }
        return starts;
    }, [lines, mode]);
    const lyrics = useMemo(() => buildSyncedLyrics(lines, taps, mode, audioRef.current?.duration || 0), [audioRef, lines, mode, taps]);
    const activeLine = useMemo(() => {
        let index = -1;
        lyrics.lines.forEach((line, i) => { if (now >= line.startTime) index = i; });
        return index;
    }, [lyrics, now]);
    const target = tapTarget(lines, mode, taps.length);

    useEffect(() => {
        const row = listRef.current?.querySelector<HTMLElement>(`[data-line="${stage === 'tap' ? target?.line ?? -1 : activeLine}"]`);
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [activeLine, stage, target?.line]);

    if (!open) return null;

    const start = (fromBeginning: boolean) => {
        setTaps([]); setStage('tap');
        if (fromBeginning) seek(0, true); else void audioRef.current?.play().catch(() => {});
    };
    const resyncFrom = (lineIndex: number) => {
        const keep = lineTapStart[lineIndex];
        const previousTime = taps[keep - 1];
        setTaps(taps.slice(0, keep)); setStage('tap');
        seek(Math.max(0, (previousTime ?? taps[keep] ?? 0) - 2), true);
    };
    const nudgeLine = (lineIndex: number, delta: number) => {
        const from = lineTapStart[lineIndex];
        const to = mode === 'line' ? from + 1 : from + splitLineWords(lines[lineIndex]).length;
        setTaps(current => current.map((time, i) => (i >= from && i < to ? Math.max(0, +(time + delta).toFixed(3)) : time)));
    };
    const save = async () => {
        if (!song || !lyrics.lines.length) return;
        setSaving(true);
        const lrc = syncedLyricsToLrc(lyrics, mode, { title: song.title || undefined, artist: artist || undefined });
        const fileName = sidecarLyricFileName(song);
        let sidecarNote = '';
        if (saveSidecar) {
            const result = await writeLocalLyricSidecar(song, lrc);
            if (result.ok) sidecarNote = ' ' + t('lyricSync.savedSidecar', { path: result.path });
            else { triggerBlobDownload(new Blob([lrc], { type: 'text/plain;charset=utf-8' }), fileName); sidecarNote = ' ' + t('lyricSync.sidecarDownloaded'); }
        }
        try {
            await onSave(lrc, fileName);
            setStatusMessage({ type: 'success', text: t('lyricSync.saved') + sidecarNote });
            closeSync();
        } catch (error) {
            console.error('[LyricSync] Could not save lyrics', error);
            setStatusMessage({ type: 'error', text: t('lyricSync.saveFailed') });
            setSaving(false);
        }
    };

    const panel = isDaylight ? 'bg-white text-zinc-900 border-black/10' : 'bg-zinc-900 text-white border-white/10';
    const soft = isDaylight ? 'bg-black/[0.05] hover:bg-black/[0.09]' : 'bg-white/[0.07] hover:bg-white/[0.13]';
    const button = `rounded-lg px-3 py-1.5 text-sm transition-colors ${soft}`;
    const accent = 'rounded-lg px-4 py-1.5 text-sm font-semibold bg-pink-600 text-white hover:bg-pink-500 disabled:opacity-40';

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-label={t('lyricSync.title')}>
            <div className={`flex max-h-[88vh] w-full max-w-2xl flex-col gap-3 rounded-2xl border p-5 shadow-2xl ${panel}`}>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-semibold">{t('lyricSync.title')}</h2>
                        <p className="text-sm opacity-60">{song ? `${song.title || song.fileName}${artist ? ' · ' + artist : ''}` : t('lyricSync.noLocalSong')}</p>
                    </div>
                    <div className="text-right font-mono text-sm opacity-70">{paused ? '❚❚' : '▶'} {formatTime(now)}</div>
                </div>

                {stage === 'text' && (
                    <>
                        <p className="text-sm opacity-70">{t('lyricSync.intro')}</p>
                        <textarea
                            className={`min-h-[260px] w-full resize-y rounded-xl border p-3 text-sm leading-relaxed outline-none ${isDaylight ? 'border-black/10 bg-black/[0.03]' : 'border-white/10 bg-white/[0.04]'}`}
                            value={text}
                            onChange={event => setText(event.target.value)}
                            placeholder={t('lyricSync.pastePlaceholder')}
                            aria-label={t('lyricSync.pasteLabel')}
                        />
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="opacity-70">{t('lyricSync.modeLabel')}</span>
                            {(['line', 'word'] as const).map(value => (
                                <button key={value} type="button" className={`${button} ${mode === value ? 'ring-2 ring-pink-500' : ''}`} onClick={() => setMode(value)}>
                                    {t(value === 'line' ? 'lyricSync.modeLine' : 'lyricSync.modeWord')}
                                </button>
                            ))}
                            <span className="ml-auto opacity-60">{t('lyricSync.tapCount', { count: tapsNeeded(lines, mode) })}</span>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                            <button type="button" className={button} onClick={closeSync}>{t('lyricSync.cancel')}</button>
                            <button type="button" className={button} disabled={!lines.length || !song} onClick={() => start(false)}>{t('lyricSync.continueHere')}</button>
                            <button type="button" className={accent} disabled={!lines.length || !song} onClick={() => start(true)}>{t('lyricSync.fromStart')}</button>
                        </div>
                    </>
                )}

                {stage !== 'text' && (
                    <>
                        <p className="text-sm opacity-70">{stage === 'tap' ? t('lyricSync.tapHint') : t('lyricSync.reviewHint')}</p>
                        <div ref={listRef} className={`min-h-[240px] flex-1 overflow-auto rounded-xl border p-2 ${isDaylight ? 'border-black/10' : 'border-white/10'}`}>
                            {lines.map((line, lineIndex) => {
                                const tapped = lyrics.lines[lineIndex];
                                const isTarget = stage === 'tap' && target?.line === lineIndex;
                                const isActive = stage === 'review' && activeLine === lineIndex;
                                const words = mode === 'word' ? splitLineWords(line) : [line];
                                return (
                                    <div key={lineIndex} data-line={lineIndex} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isTarget || isActive ? 'bg-pink-500/15' : ''}`}>
                                        <span className="w-[74px] shrink-0 font-mono text-xs opacity-60">{tapped ? formatTime(tapped.startTime) : '—'}</span>
                                        <span className={`flex-1 ${isTarget ? 'text-lg font-semibold' : 'text-sm'} ${tapped || isTarget ? '' : 'opacity-45'}`}>
                                            {words.map((word, w) => {
                                                const tapIndex = lineTapStart[lineIndex] + (mode === 'word' ? w : 0);
                                                const done = tapIndex < taps.length;
                                                const next = stage === 'tap' && tapIndex === taps.length;
                                                return <span key={w} className={`${done && mode === 'word' ? 'text-pink-500' : ''} ${next ? 'underline decoration-pink-500 decoration-2 underline-offset-4' : ''}`}>{word}</span>;
                                            })}
                                        </span>
                                        {stage === 'review' && tapped && (
                                            <span className="flex shrink-0 gap-1">
                                                <button type="button" className={button} title={t('lyricSync.playFrom')} aria-label={t('lyricSync.playFrom')} onClick={() => seek(tapped.startTime - 1, true)}>▶</button>
                                                <button type="button" className={button} aria-label={t('lyricSync.earlier')} onClick={() => nudgeLine(lineIndex, -.1)}>−0,1</button>
                                                <button type="button" className={button} aria-label={t('lyricSync.later')} onClick={() => nudgeLine(lineIndex, .1)}>+0,1</button>
                                                <button type="button" className={button} onClick={() => resyncFrom(lineIndex)}>{t('lyricSync.resyncFrom')}</button>
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <button type="button" className={button} onClick={() => seek(now - 3)}>« 3 s</button>
                            <button type="button" className={button} onClick={togglePlay}>{paused ? t('lyricSync.play') : t('lyricSync.pause')}</button>
                            <button type="button" className={button} onClick={() => seek(now + 3)}>3 s »</button>
                            {stage === 'tap' && (
                                <>
                                    <button type="button" className={accent} onClick={tap}>{t('lyricSync.tap')}</button>
                                    <button type="button" className={button} disabled={!taps.length} onClick={undo}>{t('lyricSync.undo')}</button>
                                    <span className="opacity-60">{t('lyricSync.progress', { done: taps.length, total })}</span>
                                    <button type="button" className={`${button} ml-auto`} disabled={!lyrics.lines.length} onClick={() => setStage('review')}>{t('lyricSync.review')}</button>
                                </>
                            )}
                            {stage === 'review' && (
                                <>
                                    <span className="opacity-70">{t('lyricSync.shiftAll')}</span>
                                    {[-.5, -.1, .1, .5].map(delta => (
                                        <button key={delta} type="button" className={button} onClick={() => setTaps(current => shiftTaps(current, delta))}>{delta > 0 ? '+' : '−'}{Math.abs(delta).toLocaleString('es-CL')}</button>
                                    ))}
                                    {taps.length < total && <button type="button" className={button} onClick={() => setStage('tap')}>{t('lyricSync.keepTapping')}</button>}
                                    <span className="flex w-full flex-wrap items-center gap-2 pt-1">
                                        <label className="flex items-center gap-1.5">
                                            <span className="opacity-70">BPM</span>
                                            <input type="number" min={40} max={300} step={0.1} value={bpm} onChange={event => setBpm(event.target.value)} className={`w-20 rounded-lg px-2 py-1 ${soft}`} aria-label="BPM" />
                                        </label>
                                        <select value={division} onChange={event => setDivision(Number(event.target.value))} className={`rounded-lg px-2 py-1 ${soft}`} aria-label={t('lyricSync.snapPrecision')}>
                                            <option value={1}>{t('lyricSync.snapBeat')}</option>
                                            <option value={2}>{t('lyricSync.snapHalf')}</option>
                                            <option value={4}>{t('lyricSync.snapQuarter')}</option>
                                        </select>
                                        <button type="button" className={button} disabled={!(Number(bpm) > 0) || !taps.length} title={t('lyricSync.snapHint')} onClick={() => { setBeforeSnap(taps); setTaps(quantizeTaps(taps, Number(bpm), division)); }}>{t('lyricSync.snap')}</button>
                                        {beforeSnap && <button type="button" className={button} onClick={() => { setTaps(beforeSnap); setBeforeSnap(null); }}>{t('lyricSync.undoSnap')}</button>}
                                    </span>
                                </>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
                            {stage === 'review' && (
                                <label className="mr-auto flex items-center gap-2">
                                    <input type="checkbox" checked={saveSidecar} onChange={event => setSaveSidecar(event.target.checked)} />
                                    {t('lyricSync.saveSidecar')}
                                </label>
                            )}
                            <button type="button" className={button} onClick={() => setStage('text')}>{t('lyricSync.editText')}</button>
                            <button type="button" className={button} onClick={closeSync}>{t('lyricSync.cancel')}</button>
                            {stage === 'review' && <button type="button" className={accent} disabled={saving || !lyrics.lines.length || !song} onClick={() => void save()}>{saving ? t('lyricSync.saving') : t('lyricSync.save')}</button>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default LyricSyncDialog;
