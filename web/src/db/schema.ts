import { Dexie, type EntityTable } from 'dexie';
import type { FormatId } from '../formats/formats';

/** A card as stored on this device. IndexedDB can't index booleans, hence numeric flags. */
export interface Card {
  id: string;
  name: string;
  format: FormatId;
  value: string;
  color?: string;
  notes?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  deleted: 0 | 1;
  /** Local change counter: 0 = in sync with the server; incremented on every local change. */
  dirty: number;
}

/** A card as exchanged with the server and in export files. */
export interface WireCard {
  id: string;
  name: string;
  format: FormatId;
  value: string;
  color?: string;
  notes?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  deleted: boolean;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export type WalletDb = Dexie & {
  cards: EntityTable<Card, 'id'>;
  meta: EntityTable<MetaRow, 'key'>;
};

export const db = new Dexie('unloyalty') as WalletDb;

db.version(1).stores({
  cards: 'id, dirty, deleted, sortOrder, lastUsedAt',
  meta: 'key',
});

export function toWire(card: Card): WireCard {
  const { dirty: _dirty, deleted, ...rest } = card;
  return { ...rest, deleted: deleted === 1 };
}
