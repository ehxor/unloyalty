import { useEffect, useState } from 'preact/hooks';
import { db } from '../db/schema';
import { useLiveQuery } from '../lib/useLiveQuery';
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from './client';

export interface SyncView extends SyncStatus {
  /** Cards with changes the server hasn't acknowledged. */
  pending: number;
}

/** Sync state plus the live pending count; undefined until the count has loaded (so nothing claims "Synced" early). */
export function useSyncStatus(): SyncView | undefined {
  const [status, setStatus] = useState(getSyncStatus);
  useEffect(() => subscribeSyncStatus(() => setStatus(getSyncStatus())), []);
  const pending = useLiveQuery(() => db.cards.where('dirty').above(0).count(), []);
  return pending === undefined ? undefined : { ...status, pending };
}
