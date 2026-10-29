import { db } from './schema';

export interface AccountUser {
  id: string;
  username: string;
}

export interface MetaValues {
  /** Set once navigator.storage.persist() has been requested (on first card save). */
  persistRequested: boolean;
  /** Session token for the server; absent when signed out. */
  token: string;
  /** The account this device's cards belong to. Kept after a session expires, cleared on sign-out. */
  user: AccountUser;
  /** Highest server revision this device has applied. */
  syncCursor: number;
  /** Identity of the server database the cursor refers to. */
  dbId: string;
  lastSyncAt: string;
  /** Wallet order on this device (a per-device preference, not synced). */
  sortMode: 'manual' | 'recent';
  /** The iOS "Add to Home Screen" hint was dismissed. */
  a2hsDismissed: boolean;
}

export async function getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
  return (await db.meta.get(key))?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(...keys: (keyof MetaValues)[]): Promise<void> {
  await db.meta.bulkDelete(keys);
}
