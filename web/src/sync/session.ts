import { db } from '../db/schema';
import { getMeta } from '../db/meta';
import { apiFetch, NetworkError, type ServerConfig, type SessionResponse } from './api';
import { setSyncStatus, syncNow } from './client';

export function fetchServerConfig(): Promise<ServerConfig> {
  return apiFetch<ServerConfig>('/config');
}

export type SignInMode = 'login' | 'register';

/**
 * Sign in (or create the account) and start syncing; cards already on this device join the account.
 * If this device still holds another account's cards (its session expired), `confirmSwitch` decides:
 * true wipes them first, false aborts and discards the new session.
 */
export async function signIn(mode: SignInMode, username: string, password: string, confirmSwitch: (previous: string) => boolean): Promise<void> {
  const session = await apiFetch<SessionResponse>(mode === 'login' ? '/auth/login' : '/auth/register', {
    method: 'POST',
    body: { username, password },
  });
  const previous = await getMeta('user');
  if (previous && previous.id !== session.user.id) {
    if (!confirmSwitch(previous.username)) {
      await apiFetch('/auth/logout', { method: 'POST', token: session.token }).catch(() => {});
      return;
    }
    await wipeLocalData();
  }
  await db.meta.bulkPut([
    { key: 'token', value: session.token },
    { key: 'user', value: session.user },
  ]);
  setSyncStatus({ state: 'idle' });
  await syncNow();
}

/** Sync one last time, then report how many cards still have changes the server hasn't got. */
export async function prepareSignOut(): Promise<number> {
  await syncNow();
  return db.cards.where('dirty').above(0).count();
}

/** End the session and remove every card from this device (they stay on the server). */
export async function signOut(): Promise<void> {
  const token = await getMeta('token');
  if (token) {
    try {
      await apiFetch('/auth/logout', { method: 'POST', token });
    } catch (err) {
      // Offline: the server session simply expires on its own.
      if (!(err instanceof NetworkError)) console.warn('logout failed', err);
    }
  }
  await wipeLocalData();
  setSyncStatus({ state: 'signed-out' });
}

async function wipeLocalData(): Promise<void> {
  await db.transaction('rw', db.cards, db.meta, async () => {
    await db.cards.clear();
    await db.meta.bulkDelete(['token', 'user', 'syncCursor', 'dbId', 'lastSyncAt']);
  });
}
