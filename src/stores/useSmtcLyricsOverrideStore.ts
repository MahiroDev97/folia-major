import { create } from 'zustand';
import type { SongResult } from '../types';

// src/stores/useSmtcLyricsOverrideStore.ts
// Bridges the SMTC Stage source (useSmtcSource) and the dialogs/commands that let the user pick
// other lyrics for what is playing. `song` is the synthetic song the choice is stored under;
// `revision` bumps whenever a choice is saved or cleared so the source reloads its lyrics.

export type SmtcLyricsOverrideDialog = 'match' | 'import' | null;

interface SmtcLyricsOverrideState {
    song: SongResult | null;
    hasOverride: boolean;
    dialog: SmtcLyricsOverrideDialog;
    revision: number;
    setSong: (song: SongResult | null, hasOverride: boolean) => void;
    openDialog: (dialog: Exclude<SmtcLyricsOverrideDialog, null>) => void;
    closeDialog: () => void;
    notifyChanged: () => void;
}

export const useSmtcLyricsOverrideStore = create<SmtcLyricsOverrideState>(set => ({
    song: null,
    hasOverride: false,
    dialog: null,
    revision: 0,
    setSong: (song, hasOverride) => set({ song, hasOverride }),
    openDialog: dialog => set(state => (state.song ? { dialog } : state)),
    closeDialog: () => set({ dialog: null }),
    notifyChanged: () => set(state => ({ revision: state.revision + 1 })),
}));
