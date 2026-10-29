import { onLocalChange } from '../db/events';
import { getSyncStatus, setSyncStatus, syncNow } from './client';

/** Push this long after the last local change, so a burst of edits goes in one request. */
const LOCAL_CHANGE_DELAY_MS = 2000;
/** Foreground/online events often arrive in pairs (focus + visibilitychange); coalesce them. */
const FOREGROUND_DELAY_MS = 250;

let timer: ReturnType<typeof setTimeout> | undefined;
let dueAt = Infinity;

/** Run a sync after `delayMs`, unless one is already due sooner. */
function scheduleSync(delayMs: number): void {
  const at = Date.now() + delayMs;
  if (timer !== undefined && dueAt <= at) return;
  clearTimeout(timer);
  dueAt = at;
  timer = setTimeout(() => {
    timer = undefined;
    dueAt = Infinity;
    void syncNow();
  }, delayMs);
}

/**
 * Sync on app start, when the app comes to the foreground, when the network returns, and shortly after local
 * changes. (iOS has no Background Sync for web apps, so these are the moments we get.)
 */
export function startSyncTriggers(): () => void {
  const onForeground = () => {
    if (document.visibilityState === 'visible') scheduleSync(FOREGROUND_DELAY_MS);
  };
  const onOffline = () => {
    if (getSyncStatus().state !== 'signed-out') setSyncStatus({ ...getSyncStatus(), state: 'offline' });
  };
  const stopLocal = onLocalChange(() => scheduleSync(LOCAL_CHANGE_DELAY_MS));
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('focus', onForeground);
  window.addEventListener('online', onForeground);
  window.addEventListener('offline', onOffline);
  scheduleSync(0);
  return () => {
    stopLocal();
    document.removeEventListener('visibilitychange', onForeground);
    window.removeEventListener('focus', onForeground);
    window.removeEventListener('online', onForeground);
    window.removeEventListener('offline', onOffline);
    clearTimeout(timer);
  };
}
