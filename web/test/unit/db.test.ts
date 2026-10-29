import { beforeEach, describe, expect, it } from 'vitest';
import { activeCards, addCard, deleteCard, markUsed, moveCard, sortByRecent, updateCard } from '../../src/db/cards';
import { buildExport, importCards, parseExport } from '../../src/db/exportImport';
import { db, toWire } from '../../src/db/schema';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const loyalty = { name: 'Corner Shop', format: 'ean13', value: '5901234123457' } as const;

describe('cards', () => {
  it('appends new cards at the end, dirty', async () => {
    const a = await addCard(loyalty);
    const b = await addCard({ name: 'Library', format: 'code39', value: 'LIB-42' });
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    expect((await activeCards()).map((c) => c.name)).toEqual(['Corner Shop', 'Library']);
    expect(a.dirty).toBe(1);
  });

  it('rejects invalid input', async () => {
    await expect(addCard({ ...loyalty, name: '  ' })).rejects.toThrow('Give the card a name');
    await expect(addCard({ ...loyalty, value: '5901234123458' })).rejects.toThrow(/check digit/);
  });

  it('edits bump updatedAt strictly and count local changes', async () => {
    const card = await addCard({ ...loyalty, color: '#ff0000', notes: 'PIN hint' });
    await updateCard(card.id, { ...loyalty, name: 'Renamed' });
    const after = (await db.cards.get(card.id))!;
    expect(after.name).toBe('Renamed');
    expect(after.color).toBeUndefined();
    expect(after.notes).toBeUndefined();
    expect(after.updatedAt > card.updatedAt).toBe(true);
    expect(after.dirty).toBe(2);
  });

  it('markUsed sets lastUsedAt without touching updatedAt', async () => {
    const card = await addCard(loyalty);
    await markUsed(card.id);
    const after = (await db.cards.get(card.id))!;
    expect(after.lastUsedAt).toBeDefined();
    expect(after.updatedAt).toBe(card.updatedAt);
    expect(after.dirty).toBe(2);
  });

  it('delete leaves a dirty tombstone hidden from the wallet', async () => {
    const card = await addCard(loyalty);
    await deleteCard(card.id);
    expect(await activeCards()).toEqual([]);
    const tomb = (await db.cards.get(card.id))!;
    expect(tomb.deleted).toBe(1);
    expect(tomb.updatedAt > card.updatedAt).toBe(true);
  });
});

describe('ordering', () => {
  async function wallet(...names: string[]) {
    const cards = [];
    for (const name of names) cards.push(await addCard({ name, format: 'code128', value: name }));
    await db.cards.toCollection().modify({ dirty: 0 });
    return cards;
  }
  const names = async () => (await activeCards()).map((c) => c.name);

  it.each([
    ['C', 0, ['C', 'A', 'B', 'D']],
    ['A', 2, ['B', 'C', 'A', 'D']],
    ['A', 3, ['B', 'C', 'D', 'A']],
    ['D', 1, ['A', 'D', 'B', 'C']],
  ])('moves %s to index %i', async (name, to, expected) => {
    const cards = await wallet('A', 'B', 'C', 'D');
    const card = cards.find((c) => c.name === name)!;
    await moveCard(card.id, to);
    expect(await names()).toEqual(expected);
    // Only the moved card is edited, so a reorder syncs as one change.
    const dirty = (await db.cards.toArray()).filter((c) => c.dirty > 0);
    expect(dirty.map((c) => c.name)).toEqual([name]);
    expect(dirty[0]!.updatedAt > card.updatedAt).toBe(true);
  });

  it('a move to the same place changes nothing', async () => {
    const [a] = await wallet('A', 'B');
    await moveCard(a!.id, 0);
    expect(await db.cards.where('dirty').above(0).count()).toBe(0);
  });

  it('renumbers when neighbours are too close for a midpoint', async () => {
    const [a, b, c] = await wallet('A', 'B', 'C');
    await db.cards.update(b!.id, { sortOrder: a!.sortOrder + 1e-12 });
    await moveCard(c!.id, 1);
    expect(await names()).toEqual(['A', 'C', 'B']);
    expect((await activeCards()).map((x) => x.sortOrder)).toEqual([1, 2, 3]);
  });

  it('recent order puts the last opened first and never-opened cards after, in wallet order', async () => {
    const [a, , c] = await wallet('A', 'B', 'C', 'D');
    await db.cards.update(c!.id, { lastUsedAt: '2026-01-01T00:00:00.000Z' });
    await db.cards.update(a!.id, { lastUsedAt: '2026-02-01T00:00:00.000Z' });
    expect(sortByRecent(await activeCards()).map((x) => x.name)).toEqual(['A', 'C', 'B', 'D']);
  });
});

describe('export / import', () => {
  it('export → wipe → import restores every card', async () => {
    await addCard({ ...loyalty, color: '#123abc', notes: 'since 2019' });
    await addCard({ name: 'Gym', format: 'qr', value: 'member:9981' });
    const exported = JSON.stringify(await buildExport());

    await db.delete();
    await db.open();
    const { cards, invalid } = parseExport(exported);
    expect(await importCards(cards, invalid)).toEqual({ added: 2, updated: 0, unchanged: 0, invalid: 0 });
    const restored = (await activeCards()).map(toWire);
    expect(restored).toEqual(JSON.parse(exported).cards);
    expect((await activeCards()).every((c) => c.dirty > 0)).toBe(true);
  });

  it('merges by id with last-write-wins on updatedAt', async () => {
    const card = await addCard(loyalty);
    const older = { ...toWire(card), name: 'Older', updatedAt: '2000-01-01T00:00:00.000Z' };
    const newer = { ...toWire(card), name: 'Newer', updatedAt: '2999-01-01T00:00:00.000Z' };

    expect(await importCards([older])).toMatchObject({ unchanged: 1 });
    expect((await db.cards.get(card.id))!.name).toBe('Corner Shop');

    expect(await importCards([newer])).toMatchObject({ updated: 1 });
    const merged = (await db.cards.get(card.id))!;
    expect(merged.name).toBe('Newer');
    expect(merged.dirty).toBe(2);
  });

  it('counts invalid cards and rejects foreign files', () => {
    const file = { app: 'unloyalty', version: 1, exportedAt: '', cards: [{ id: 'nope' }] };
    expect(parseExport(JSON.stringify(file))).toEqual({ cards: [], invalid: 1 });
    expect(() => parseExport('{"cards":[]}')).toThrow(/isn’t an Unloyalty export/);
    expect(() => parseExport('not json')).toThrow(/valid JSON/);
  });
});
