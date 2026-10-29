import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCard, markUsed, updateCard } from '../../src/db/cards';
import { getMeta, setMeta } from '../../src/db/meta';
import { db, toWire, type WireCard } from '../../src/db/schema';
import type { SyncRequest } from '../../src/sync/api';
import { getSyncStatus, SYNC_BATCH, syncNow } from '../../src/sync/client';

type Handler = (req: SyncRequest) => Promise<Response> | Response;

let requests: SyncRequest[];
let handler: Handler;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (cursor: number, changes: unknown[], dbId = 'db-1') => json(200, { dbId, cursor, changes });

/** A server that accepts everything and echoes it back (what the real one does when no one else wrote). */
const acceptAll: Handler = (req) => ok(req.cursor + req.changes.length, req.changes);

beforeEach(async () => {
  await db.delete();
  await db.open();
  await setMeta('token', 'tok');
  await setMeta('user', { id: 'u1', username: 'alice' });
  requests = [];
  handler = acceptAll;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/sync');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    const req = JSON.parse(String(init.body)) as SyncRequest;
    requests.push(req);
    return handler(req);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const shop = { name: 'Shop', format: 'code128', value: 'ABC-1' } as const;

function serverCard(overrides: Partial<WireCard> = {}): WireCard {
  return {
    id: '01900000-0000-7000-8000-0000000000aa',
    name: 'From server',
    format: 'qr',
    value: 'member:1',
    sortOrder: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleted: false,
    ...overrides,
  };
}

describe('syncNow', () => {
  it('pushes dirty cards, marks them clean and remembers the cursor and database', async () => {
    const card = await addCard(shop);
    await syncNow();
    expect(requests).toEqual([{ cursor: 0, changes: [toWire(card)] }]);
    expect((await db.cards.get(card.id))!.dirty).toBe(0);
    expect(await getMeta('syncCursor')).toBe(1);
    expect(getSyncStatus().state).toBe('idle');

    await syncNow();
    expect(requests[1]).toEqual({ cursor: 1, dbId: 'db-1', changes: [] });
  });

  it('applies cards and tombstones pulled from the server', async () => {
    const mine = await addCard(shop);
    handler = () => ok(3, [serverCard(), { ...toWire(mine), deleted: true, updatedAt: '2999-01-01T00:00:00.000Z' }]);
    await syncNow();
    expect(await db.cards.get(serverCard().id)).toMatchObject({ name: 'From server', dirty: 0, deleted: 0 });
    expect(await db.cards.get(mine.id)).toMatchObject({ deleted: 1, dirty: 0 });
  });

  it('takes the server version when a pushed edit lost, and stops re-sending it', async () => {
    const card = await addCard(shop);
    const winner = { ...toWire(card), name: 'Newer elsewhere', updatedAt: '2999-01-01T00:00:00.000Z' };
    handler = () => ok(7, [winner]);
    await syncNow();
    expect(await db.cards.get(card.id)).toMatchObject({ name: 'Newer elsewhere', dirty: 0 });
  });

  it('keeps an edit made while the request was in flight dirty, then pushes it', async () => {
    const card = await addCard(shop);
    handler = async (req) => {
      if (requests.length === 1) await updateCard(card.id, { ...shop, name: 'Edited mid-flight' });
      return acceptAll(req);
    };
    await syncNow();
    const local = (await db.cards.get(card.id))!;
    expect(local).toMatchObject({ name: 'Edited mid-flight' });
    expect(local.dirty).toBeGreaterThan(0);

    await syncNow();
    expect(requests.at(-1)!.changes.map((c) => c.name)).toEqual(['Edited mid-flight']);
    expect((await db.cards.get(card.id))!.dirty).toBe(0);
  });

  it('merges lastUsedAt by max and keeps a newer local checkout dirty', async () => {
    const card = await addCard(shop);
    handler = async (req) => {
      if (requests.length === 1) await markUsed(card.id);
      return acceptAll(req); // echoes the card without the new lastUsedAt
    };
    await syncNow();
    const local = (await db.cards.get(card.id))!;
    expect(local.lastUsedAt).toBeDefined();
    expect(local.dirty).toBeGreaterThan(0);

    // A server copy with an older lastUsedAt never rolls ours back.
    handler = () => ok(9, [{ ...toWire(card), lastUsedAt: '2000-01-01T00:00:00.000Z' }]);
    await syncNow();
    expect((await db.cards.get(card.id))!.lastUsedAt).toBe(local.lastUsedAt);
  });

  it('starts over from cursor 0 and re-sends everything when the server database changed', async () => {
    const card = await addCard(shop);
    await syncNow();
    handler = (req) => (req.dbId ? json(409, { error: { code: 'cursor_reset', message: 'reset' } }) : ok(1, req.changes, 'db-2'));
    await syncNow();
    expect(requests.slice(1)).toEqual([
      { cursor: 1, dbId: 'db-1', changes: [] },
      { cursor: 0, changes: [toWire({ ...card, dirty: 0 })] },
    ]);
    expect(await getMeta('dbId')).toBe('db-2');
    expect((await db.cards.get(card.id))!.dirty).toBe(0);
  });

  it('on 401 drops the token but keeps the account name and every card', async () => {
    const card = await addCard(shop);
    handler = () => json(401, { error: { code: 'unauthorized', message: 'Session expired' } });
    await syncNow();
    expect(await getMeta('token')).toBeUndefined();
    expect(await getMeta('user')).toEqual({ id: 'u1', username: 'alice' });
    expect((await db.cards.get(card.id))!.dirty).toBe(1);
    expect(getSyncStatus()).toMatchObject({ state: 'signed-out', sessionExpired: true });
  });

  it('reports offline and keeps changes when the server is unreachable', async () => {
    const card = await addCard(shop);
    handler = () => {
      throw new TypeError('Failed to fetch');
    };
    await syncNow();
    expect(getSyncStatus().state).toBe('offline');
    expect((await db.cards.get(card.id))!.dirty).toBe(1);
  });

  it('sends large backlogs in batches', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await db.cards.bulkAdd(
      Array.from({ length: SYNC_BATCH + 20 }, (_, i) => ({
        id: `01900000-0000-7000-8000-${String(i).padStart(12, '0')}`,
        name: `Card ${i}`,
        format: 'code128' as const,
        value: `V${i}`,
        sortOrder: i,
        createdAt: now,
        updatedAt: now,
        deleted: 0 as const,
        dirty: 1,
      })),
    );
    await syncNow();
    expect(requests.map((r) => r.changes.length)).toEqual([SYNC_BATCH, 20]);
    expect(await db.cards.where('dirty').above(0).count()).toBe(0);
  });

  it('discards a response that arrives after signing out', async () => {
    await addCard(shop);
    handler = async (req) => {
      await db.cards.clear();
      await db.meta.delete('token');
      return ok(1, [...req.changes, serverCard()]);
    };
    await syncNow();
    expect(await db.cards.count()).toBe(0);
    expect(await getMeta('syncCursor')).toBeUndefined();
  });

  it('runs one sync at a time and goes round again for calls made meanwhile', async () => {
    const firstRequest = Promise.withResolvers<void>();
    let inFlight = 0;
    let maxInFlight = 0;
    handler = async (req) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (requests.length === 1) await firstRequest.promise;
      inFlight--;
      return acceptAll(req);
    };
    const all = Promise.all([syncNow(), syncNow(), syncNow()]);
    await vi.waitUntil(() => requests.length === 1);
    firstRequest.resolve();
    await all;
    expect(maxInFlight).toBe(1);
    expect(requests).toHaveLength(2);
  });
});
