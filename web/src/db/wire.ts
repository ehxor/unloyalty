import { isCanonicalIso } from '../lib/time';
import { validateCardInput } from './cards';
import type { WireCard } from './schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Validate untrusted JSON (import file or server response) as a WireCard; returns an error string on failure. */
export function parseWireCard(raw: unknown): WireCard | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object';
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID_RE.test(r.id)) return 'invalid id';
  for (const key of ['name', 'format', 'value'] as const) {
    if (typeof r[key] !== 'string') return `invalid ${key}`;
  }
  for (const key of ['color', 'notes'] as const) {
    if (r[key] !== undefined && r[key] !== null && typeof r[key] !== 'string') return `invalid ${key}`;
  }
  if (typeof r.sortOrder !== 'number' || !Number.isFinite(r.sortOrder)) return 'invalid sortOrder';
  if (!isCanonicalIso(r.createdAt) || !isCanonicalIso(r.updatedAt)) return 'invalid timestamps';
  if (r.lastUsedAt !== undefined && r.lastUsedAt !== null && !isCanonicalIso(r.lastUsedAt)) return 'invalid lastUsedAt';
  if (typeof r.deleted !== 'boolean') return 'invalid deleted';

  const card: WireCard = {
    id: r.id,
    name: r.name as string,
    format: r.format as WireCard['format'],
    value: r.value as string,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deleted: r.deleted,
  };
  if (typeof r.color === 'string' && r.color !== '') card.color = r.color;
  if (typeof r.notes === 'string' && r.notes !== '') card.notes = r.notes;
  if (typeof r.lastUsedAt === 'string') card.lastUsedAt = r.lastUsedAt;

  const error = validateCardInput(card);
  if (error) return error;
  if (card.name !== card.name.trim()) return 'invalid name';
  return card;
}
