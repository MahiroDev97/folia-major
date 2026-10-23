import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import OnlineSongLyricMatch from '../../modal/lyric-match/OnlineSongLyricMatch';
import { useSmtcLyricsOverrideStore } from '../../../stores/useSmtcLyricsOverrideStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { readLyricFile } from '../../../utils/lyrics/lyricFileDecoding';
import { importSmtcOverrideLyrics } from '../../../utils/smtcLyricsOverride';

// src/components/app/stage/SmtcLyricsOverrideDialogs.tsx
// The two ways to replace the lyrics of what Spotify / YouTube is playing in Stage: Folia's online
// lyric search (the same modal online songs use) or importing a lyric file. Both save the choice
// for that track; useSmtcSource picks it up through the store's revision. Opened from the
// command palette, so it renders nothing until asked.

const LYRIC_IMPORT_ACCEPT = '.lrc,.vtt,.ttml,.qrc,.yrc,.krc,.txt,.fia,.json';

const SmtcLyricsOverrideDialogs: React.FC = () => {
    const { t } = useTranslation();
    const song = useSmtcLyricsOverrideStore(state => state.song);
    const dialog = useSmtcLyricsOverrideStore(state => state.dialog);
    const closeDialog = useSmtcLyricsOverrideStore(state => state.closeDialog);
    const notifyChanged = useSmtcLyricsOverrideStore(state => state.notifyChanged);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // The palette command that opened this still holds the user activation a file picker needs.
    useEffect(() => {
        if (dialog !== 'import') return;
        const input = fileInputRef.current;
        if (!input) return;
        const handleCancel = () => closeDialog();
        input.addEventListener('cancel', handleCancel);
        input.value = '';
        input.click();
        return () => input.removeEventListener('cancel', handleCancel);
    }, [closeDialog, dialog]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        closeDialog();
        if (!file || !song) return;
        try {
            const imported = await importSmtcOverrideLyrics(song, await readLyricFile(file), file.name);
            if (!imported) {
                setStatusMessage({ type: 'error', text: t('status.smtcLyricsImportFailed') });
                return;
            }
            notifyChanged();
            setStatusMessage({ type: 'success', text: t('status.smtcLyricsSaved') });
        } catch (error) {
            console.error('[SMTC] Failed to import lyrics', error);
            setStatusMessage({ type: 'error', text: t('status.smtcLyricsImportFailed') });
        }
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept={LYRIC_IMPORT_ACCEPT}
                className="hidden"
                onChange={event => void handleFileChange(event)}
            />
            {dialog === 'match' && song && (
                <OnlineSongLyricMatch
                    song={song}
                    isDaylight={isDaylight}
                    onClose={closeDialog}
                    onMatch={() => {
                        closeDialog();
                        notifyChanged();
                        setStatusMessage({ type: 'success', text: t('status.smtcLyricsSaved') });
                    }}
                />
            )}
        </>
    );
};

export default SmtcLyricsOverrideDialogs;
