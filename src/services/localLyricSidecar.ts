import type { LocalSong } from '../types';
import { getDirHandles } from './db';

// src/services/localLyricSidecar.ts
// Writes a `.lrc` next to a local song's audio file, through the folder handle the library was
// imported with (`<root>/<dirs>/<file>` → `<root>/<dirs>/<file name>.lrc`). Folia's next scan reads
// it as the song's sidecar lyrics, and other players find it too. The library folder was granted
// read access when imported, so this asks for write access first; any failure is reported, never
// thrown, and the caller falls back to a download.

type PermissionMode = { mode: 'read' | 'readwrite' };
type HandleWithPermission = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (descriptor: PermissionMode) => Promise<PermissionState>;
};

export type SidecarWriteResult = { ok: true; path: string } | { ok: false; reason: 'no-folder' | 'denied' | 'failed' };

export const sidecarLyricFileName = (song: Pick<LocalSong, 'fileName' | 'filePath'>): string => {
  const name = song.fileName || song.filePath.split('/').pop() || 'lyrics';
  return name.replace(/\.[^.]+$/, '') + '.lrc';
};

export async function writeLocalLyricSidecar(song: Pick<LocalSong, 'fileName' | 'filePath'>, content: string): Promise<SidecarWriteResult> {
  const parts = song.filePath.split('/').filter(Boolean);
  const root = parts.shift();
  parts.pop(); // the audio file itself
  try {
    const handles = await getDirHandles();
    let dir = root ? handles[root] as HandleWithPermission | undefined : undefined;
    if (!dir) return { ok: false, reason: 'no-folder' };
    let permission = await dir.queryPermission?.({ mode: 'readwrite' });
    if (permission !== 'granted') permission = await dir.requestPermission?.({ mode: 'readwrite' });
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
    for (const name of parts) dir = await dir.getDirectoryHandle(name) as HandleWithPermission;
    const fileName = sidecarLyricFileName(song);
    const file = await dir.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
    return { ok: true, path: [root, ...parts, fileName].join('/') };
  } catch (error) {
    console.warn('[LyricSync] Could not write the sidecar .lrc', error);
    return { ok: false, reason: 'failed' };
  }
}
