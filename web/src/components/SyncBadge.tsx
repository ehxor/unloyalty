import { useSyncStatus, type SyncView } from '../sync/useSyncStatus';

function label(s: SyncView): string | null {
  switch (s.state) {
    case 'starting':
      return null;
    case 'signed-out':
      return s.sessionExpired ? 'Signed out' : 'Local only';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return s.pending ? `Offline · ${s.pending} waiting` : 'Offline';
    case 'error':
      return 'Sync error';
    case 'idle':
      return s.pending ? `${s.pending} waiting` : 'Synced';
  }
}

/** Header chip: synced / pending changes / offline / not signed in. Tapping it opens Settings. */
export function SyncBadge() {
  const status = useSyncStatus();
  if (!status) return null;
  const text = label(status);
  if (!text) return null;
  const tone = status.state === 'error' || status.sessionExpired ? 'warn' : status.state === 'idle' && !status.pending ? 'ok' : 'muted';
  return (
    <a class={`sync-badge ${tone}`} href="/settings" aria-label={`Sync status: ${text}`} data-state={status.state}>
      {text}
    </a>
  );
}
