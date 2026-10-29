import { maxIso, nowIso } from '../lib/time';
import { activeCards } from './cards';
import { localChanged } from './events';
import { db, toWire, type Card, type WireCard } from './schema';
import { parseWireCard } from './wire';

export const EXPORT_APP = 'unloyalty';
export const EXPORT_VERSION = 1;

export interface ExportFile {
  app: typeof EXPORT_APP;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  cards: WireCard[];
}

export async function buildExport(): Promise<ExportFile> {
  return { app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: nowIso(), cards: (await activeCards()).map(toWire) };
}

export function exportFilename(date = new Date()): string {
  return `unloyalty-${date.toISOString().slice(0, 10)}.json`;
}

/** Parse an export file; throws a user-facing error if the whole file is unusable. */
export function parseExport(text: string): { cards: WireCard[]; invalid: number } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('This file isn\u2019t valid JSON');
  }
  const file = json as Partial<ExportFile> | null;
  if (!file || file.app !== EXPORT_APP || !Array.isArray(file.cards)) throw new Error('This isn\u2019t an Unloyalty export file');
  if (file.version !== EXPORT_VERSION) throw new Error(`Unsupported export version ${String(file.version)}`);
  const cards: WireCard[] = [];
  let invalid = 0;
  for (const raw of file.cards) {
    const parsed = parseWireCard(raw);
    if (typeof parsed === 'string') invalid++;
    else cards.push(parsed);
  }
  return { cards, invalid };
}

export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
  invalid: number;
}

/**
 * Merge cards by id with last-write-wins on updatedAt (lastUsedAt merges by max).
 * Winners are marked dirty so they sync to the server.
 */
export async function importCards(cards: WireCard[], invalid = 0): Promise<ImportSummary> {
  const summary: ImportSummary = { added: 0, updated: 0, unchanged: 0, invalid };
  await db.transaction('rw', db.cards, async () => {
    for (const incoming of cards) {
      const local = await db.cards.get(incoming.id);
      const { deleted, ...fields } = incoming;
      if (!local) {
        await db.cards.add({ ...fields, deleted: deleted ? 1 : 0, dirty: 1 });
        summary.added++;
      } else if (incoming.updatedAt > local.updatedAt) {
        const lastUsedAt = maxIso(local.lastUsedAt, incoming.lastUsedAt);
        const next: Card = { ...fields, deleted: deleted ? 1 : 0, dirty: local.dirty + 1 };
        if (lastUsedAt) next.lastUsedAt = lastUsedAt;
        await db.cards.put(next);
        summary.updated++;
      } else {
        summary.unchanged++;
      }
    }
  });
  if (summary.added + summary.updated > 0) localChanged();
  return summary;
}
