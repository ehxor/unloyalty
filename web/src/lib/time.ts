/**
 * Timestamps are canonical UTC ISO strings with millisecond precision ("2026-01-02T03:04:05.678Z"),
 * so lexical comparison equals chronological comparison — on the client and on the server.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Next `updatedAt` for a card: strictly after the previous one even if the clock went backwards. */
export function nextUpdatedAt(previous?: string): string {
  const now = Date.now();
  const prev = previous ? Date.parse(previous) : Number.NEGATIVE_INFINITY;
  return new Date(Math.max(now, prev + 1)).toISOString();
}

export function isCanonicalIso(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function maxIso(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a > b ? a : b;
}
