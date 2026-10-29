import { isFormatId, type FormatId } from '../formats/formats';
import { normalizeValue } from '../formats/validate';
import { nextUpdatedAt, nowIso } from '../lib/time';
import { uuidv7 } from '../lib/uuidv7';
import { localChanged } from './events';
import { db, type Card } from './schema';

export interface CardInput {
  name: string;
  format: FormatId;
  value: string;
  color?: string;
  notes?: string;
}

export const NAME_MAX = 100;
export const NOTES_MAX = 1000;
export const COLOR_RE = /^#[0-9a-f]{6}$/;

/** Returns a user-facing error, or null if the fields are storable as-is. */
export function validateCardInput(input: CardInput): string | null {
  const name = input.name.trim();
  if (name === '') return 'Give the card a name';
  if (name.length > NAME_MAX) return `Name must be at most ${NAME_MAX} characters`;
  if (!isFormatId(input.format)) return 'Unknown barcode format';
  const value = normalizeValue(input.format, input.value);
  if (!value.ok) return value.error;
  if (value.value !== input.value) return 'Barcode value is not normalised';
  if (input.color !== undefined && !COLOR_RE.test(input.color)) return 'Colour must be a #rrggbb hex value';
  if (input.notes !== undefined && input.notes.length > NOTES_MAX) return `Notes must be at most ${NOTES_MAX} characters`;
  return null;
}

function cleanInput(input: CardInput): CardInput {
  const notes = input.notes?.trim();
  return {
    name: input.name.trim(),
    format: input.format,
    value: input.value,
    ...(input.color ? { color: input.color } : {}),
    ...(notes ? { notes } : {}),
  };
}

export async function addCard(input: CardInput): Promise<Card> {
  const error = validateCardInput(input);
  if (error) throw new Error(error);
  const card = await db.transaction('rw', db.cards, async () => {
    const last = await db.cards.orderBy('sortOrder').last();
    const now = nowIso();
    const created: Card = {
      id: uuidv7(),
      ...cleanInput(input),
      sortOrder: (last?.sortOrder ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
      deleted: 0,
      dirty: 1,
    };
    await db.cards.add(created);
    return created;
  });
  localChanged();
  return card;
}

/** Replace the editable fields of a card (name, barcode, colour, notes). */
export async function updateCard(id: string, input: CardInput): Promise<void> {
  const error = validateCardInput(input);
  if (error) throw new Error(error);
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id);
    if (!card || card.deleted) throw new Error('Card not found');
    const { color: _c, notes: _n, ...rest } = card;
    await db.cards.put({ ...rest, ...cleanInput(input), updatedAt: nextUpdatedAt(card.updatedAt), dirty: card.dirty + 1 });
  });
  localChanged();
}

/** Soft-delete: the tombstone syncs so other devices drop the card too. */
export async function deleteCard(id: string): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id);
    if (!card || card.deleted) return;
    await db.cards.update(id, { deleted: 1, updatedAt: nextUpdatedAt(card.updatedAt), dirty: card.dirty + 1 });
  });
  localChanged();
}

/** Record a checkout view. Deliberately leaves `updatedAt` alone: lastUsedAt merges by max(), not last-write-wins. */
export async function markUsed(id: string): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id);
    if (!card || card.deleted) return;
    await db.cards.update(id, { lastUsedAt: nowIso(), dirty: card.dirty + 1 });
  });
  localChanged();
}

export async function activeCards(): Promise<Card[]> {
  return db.cards.orderBy('sortOrder').filter((c) => c.deleted === 0).toArray();
}

/** Below this gap between neighbours, a midpoint loses precision: renumber the whole wallet instead. */
const MIN_SORT_GAP = 1e-9;

/**
 * Move a card to `toIndex` in wallet order. Normally only the moved card changes (its sortOrder becomes the
 * midpoint of its new neighbours), so a reorder syncs as a single-card edit.
 */
export async function moveCard(id: string, toIndex: number): Promise<void> {
  const moved = await db.transaction('rw', db.cards, async () => {
    const order = await activeCards();
    const from = order.findIndex((c) => c.id === id);
    if (from < 0) return false;
    const [card] = order.splice(from, 1);
    const index = Math.max(0, Math.min(toIndex, order.length));
    if (index === from) return false;
    const prev = order[index - 1]?.sortOrder;
    const next = order[index]?.sortOrder;

    if (prev !== undefined && next !== undefined && next - prev < MIN_SORT_GAP) {
      order.splice(index, 0, card!);
      for (const [i, c] of order.entries()) {
        if (c.sortOrder !== i + 1) await db.cards.update(c.id, { sortOrder: i + 1, updatedAt: nextUpdatedAt(c.updatedAt), dirty: c.dirty + 1 });
      }
      return true;
    }
    const sortOrder = prev === undefined ? (next ?? 1) - 1 : next === undefined ? prev + 1 : (prev + next) / 2;
    await db.cards.update(id, { sortOrder, updatedAt: nextUpdatedAt(card!.updatedAt), dirty: card!.dirty + 1 });
    return true;
  });
  if (moved) localChanged();
}

/** "Recently used" order: last opened first; never-opened cards follow in wallet order. */
export function sortByRecent(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.lastUsedAt !== b.lastUsedAt) {
      if (!a.lastUsedAt) return 1;
      if (!b.lastUsedAt) return -1;
      return a.lastUsedAt > b.lastUsedAt ? -1 : 1;
    }
    return a.sortOrder - b.sortOrder;
  });
}
