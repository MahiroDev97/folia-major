// electron/smtc/smtcMonitor.cjs
// Windows-only: runs smtcHelper.ps1 in a child Windows PowerShell and turns its JSON lines into
// session snapshots (music apps, browsers playing a video site, any SMTC publisher). Native SMTC addons
// deadlock on Electron's STA main thread and drop the measurement timestamp, so a helper process
// that reports LastUpdatedTime is both simpler and more accurate for lyric sync.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HELPER_PATH = path.join(__dirname, 'smtcHelper.ps1');
const RESTART_DELAY_MS = 3000;
const MAX_RESTART_DELAY_MS = 30000;

function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.appId !== 'string' || !raw.appId) {
    return null;
  }

  const toNumber = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
  return {
    appId: raw.appId,
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    artist: typeof raw.artist === 'string' ? raw.artist.trim() : '',
    album: typeof raw.album === 'string' ? raw.album.trim() : '',
    status: typeof raw.status === 'string' ? raw.status : 'closed',
    positionMs: toNumber(raw.positionMs),
    durationMs: toNumber(raw.durationMs),
    updatedAtMs: toNumber(raw.updatedAtMs),
  };
}

// Parses one helper line into { sessions, currentAppId }; returns null for anything malformed.
function parseHelperLine(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  // Windows PowerShell 5.1 serializes a one-element array as a bare object.
  const rawSessions = Array.isArray(payload.sessions)
    ? payload.sessions
    : (payload.sessions ? [payload.sessions] : []);

  return {
    sessions: rawSessions.map(normalizeSession).filter(Boolean),
    currentAppId: typeof payload.currentAppId === 'string' ? payload.currentAppId : null,
    receivedAtMs: Date.now(),
  };
}

function buildEncodedCommand(parentPid) {
  const script = `$ParentPid = ${Number(parentPid) || 0}\n${fs.readFileSync(HELPER_PATH, 'utf8')}`;
  return Buffer.from(script, 'utf16le').toString('base64');
}

function createSmtcMonitor({ onSnapshot, onStatus, platform = process.platform, spawnImpl = spawn, logger = console } = {}) {
  let child = null;
  let running = false;
  let restartTimer = null;
  let restartDelayMs = RESTART_DELAY_MS;
  let lastSnapshot = null;
  let status = platform === 'win32' ? 'stopped' : 'unsupported';

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    onStatus?.(next);
  };

  const scheduleRestart = () => {
    if (!running || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      launch();
    }, restartDelayMs);
    restartDelayMs = Math.min(MAX_RESTART_DELAY_MS, restartDelayMs * 2);
  };

  function launch() {
    if (!running || child) return;
    setStatus('starting');

    let proc;
    try {
      proc = spawnImpl('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', buildEncodedCommand(process.pid),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      logger.warn('[SMTC] Failed to start helper', error);
      setStatus('error');
      scheduleRestart();
      return;
    }

    child = proc;
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const snapshot = parseHelperLine(line);
        if (!snapshot) continue;
        restartDelayMs = RESTART_DELAY_MS;
        lastSnapshot = snapshot;
        setStatus('running');
        onSnapshot?.(snapshot);
      }
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      // -EncodedCommand reports streams as CLIXML; the progress records are noise.
      if (text && !text.startsWith('#< CLIXML') && !text.includes('S="progress"')) {
        logger.warn('[SMTC] helper:', text);
      }
    });

    proc.on('error', (error) => {
      logger.warn('[SMTC] helper process error', error);
    });

    proc.on('exit', (code) => {
      if (child === proc) child = null;
      if (!running) {
        setStatus('stopped');
        return;
      }
      logger.warn(`[SMTC] helper exited with code ${code}; restarting`);
      setStatus('error');
      scheduleRestart();
    });
  }

  return {
    start() {
      if (platform !== 'win32' || running) return;
      running = true;
      launch();
    },
    stop() {
      running = false;
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      if (child) {
        child.kill();
        child = null;
      }
      lastSnapshot = null;
      setStatus(platform === 'win32' ? 'stopped' : 'unsupported');
    },
    getStatus: () => status,
    getSnapshot: () => lastSnapshot,
  };
}

module.exports = { createSmtcMonitor, parseHelperLine };
