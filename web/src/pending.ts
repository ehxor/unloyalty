import type { FormatId } from './formats/formats';

export interface PendingBarcode {
  format: FormatId;
  value: string;
}

interface Pending extends PendingBarcode {
  /** Set when re-scanning: the card whose barcode this replaces. */
  forCard?: string;
}

/**
 * A scanned barcode on its way to a form (new card, or replacing an existing card's barcode).
 * Kept in memory rather than the URL because card values are private and shouldn't land in history.
 */
let pending: Pending | null = null;

export function setPendingBarcode(barcode: PendingBarcode, forCard?: string): void {
  pending = forCard ? { ...barcode, forCard } : { ...barcode };
}

/** The pending barcode for a new card (`forCard` omitted) or for re-scanning that card. */
export function peekPendingBarcode(forCard?: string): PendingBarcode | null {
  if (!pending || pending.forCard !== forCard) return null;
  return { format: pending.format, value: pending.value };
}

export function clearPendingBarcode(): void {
  pending = null;
}
