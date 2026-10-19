import { create } from 'zustand';

// src/stores/useLyricSyncStore.ts
// Opens the tap-to-sync lyric editor for the current local song (from the player panel's local
// tab or the command palette). The dialog itself is mounted once in App.tsx.

interface LyricSyncState {
    open: boolean;
    openSync: () => void;
    closeSync: () => void;
}

export const useLyricSyncStore = create<LyricSyncState>(set => ({
    open: false,
    openSync: () => set({ open: true }),
    closeSync: () => set({ open: false }),
}));
