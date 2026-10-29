import { deleteMeta, getMeta } from '../db/meta';
import { db, toWire, type Card } from '../db/schema';
import { parseWireCard } from '../db/wire';
import { maxIso, nowIso } from '../lib/time';
import { ApiError, apiFetch, NetworkError, type SyncRequest, type SyncResponse } from './api';

export type SyncState = 'starting' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt?: string;
  /** Set when the last attempt failed with a server error. */
  error?: string;
  /** Signed out because the server rejected the session (expired or revoked), not by the user. */
  sessionExpired?: boolean;
}

/** Cards per request; the server accepts at most 500. */
export const SYNC_BATCH = 500;
/** Upper bound on request rounds per sync, so a misbehaving server can't spin the client. */
const MAX_ROUNDS = 50;

let status: SyncStatus = { state: 'starting' };
const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSyncStatus(next: SyncStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

let running: Promise<void> | null = null;
let rerun = false;

/**
 * Run a sync now. Single-flight: a call during a running sync makes it go round once more
 * (so changes made mid-flight are pushed) and resolves when that finishes.
 */
export function syncNow(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await runSync();
      } while (rerun);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function runSync(): Promise<void> {
  const token = await getMeta('token');
  const lastSyncAt = await getMeta('lastSyncAt');
  if (!token) {
    setSyncStatus({ state: 'signed-out', sessionExpired: status.sessionExpired });
    return;
  }
  if (navigator.onLine === false) {
    setSyncStatus({ state: 'offline', lastSyncAt });
    return;
  }
  setSyncStatus({ state: 'syncing', lastSyncAt });
  try {
    let resetDone = false;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const sent = await db.cards.where('dirty').above(0).limit(SYNC_BATCH).toArray();
      const request: SyncRequest = { cursor: (await getMeta('syncCursor')) ?? 0, changes: sent.map(toWire) };
      const dbId = await getMeta('dbId');
      if (dbId) request.dbId = dbId;

      let response: SyncResponse;
      try {
        response = await apiFetch<SyncResponse>('/sync', { method: 'POST', token, body: request });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'cursor_reset' && !resetDone) {
          // The server's database was replaced (e.g. restored from backup): start over and re-send everything.
          resetDone = true;
          await resetCursor();
          continue;
        }
        throw err;
      }
      if (!(await applyResponse(token, response))) return; // signed out while the request was in flight
      if (sent.length < SYNC_BATCH) break;
    }
    setSyncStatus({ state: 'idle', lastSyncAt: await getMeta('lastSyncAt') });
  } catch (err) {
    if (err instanceof NetworkError) {
      setSyncStatus({ state: 'offline', lastSyncAt });
    } else if (err instanceof ApiError && err.status === 401) {
      // Keep the cards and the account name: the user signs in again and nothing is lost.
      await deleteMeta('token');
      setSyncStatus({ state: 'signed-out', sessionExpired: true });
    } else {
      setSyncStatus({ state: 'error', lastSyncAt, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

async function resetCursor(): Promise<void> {
  await db.transaction('rw', db.cards, db.meta, async () => {
    await db.meta.bulkDelete(['syncCursor', 'dbId']);
    await db.cards.toCollection().modify((card) => {
      card.dirty += 1;
    });
  });
}

/**
 * Merge the server's answer: for each card, the later updatedAt wins (server wins ties, since it echoes what it stored);
 * lastUsedAt always takes the later of the two. A card stays dirty only if this device still has something newer
 * (an edit or a checkout view made while the request was in flight). Returns false if the session changed meanwhile.
 */
async function applyResponse(token: string, response: SyncResponse): Promise<boolean> {
  return db.transaction('rw', db.cards, db.meta, async () => {
    if ((await db.meta.get('token'))?.value !== token) return false;
    for (const raw of response.changes) {
      const incoming = parseWireCard(raw);
      if (typeof incoming === 'string') {
        console.warn('sync: ignoring invalid card from server:', incoming);
        continue;
      }
      const local = await db.cards.get(incoming.id);
      const { deleted, ...fields } = incoming;
      const lastUsedAt = maxIso(local?.lastUsedAt, incoming.lastUsedAt);
      let next: Card;
      if (!local || incoming.updatedAt >= local.updatedAt) {
        const usedLater = lastUsedAt !== incoming.lastUsedAt;
        next = { ...fields, deleted: deleted ? 1 : 0, dirty: usedLater ? Math.max(local?.dirty ?? 0, 1) : 0 };
      } else {
        next = { ...local, dirty: Math.max(local.dirty, 1) };
      }
      if (lastUsedAt) next.lastUsedAt = lastUsedAt;
      else delete next.lastUsedAt;
      await db.cards.put(next);
    }
    await db.meta.bulkPut([
      { key: 'syncCursor', value: response.cursor },
      { key: 'dbId', value: response.dbId },
      { key: 'lastSyncAt', value: nowIso() },
    ]);
    return true;
  });
}
