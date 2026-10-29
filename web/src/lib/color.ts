export const PALETTE = [
  '#c0392b',
  '#d35400',
  '#e1a100',
  '#2e8b57',
  '#16807a',
  '#1f6fb2',
  '#3b4cc0',
  '#7b3fb5',
  '#b0307a',
  '#6d4c41',
  '#455a64',
  '#222222',
] as const;

/** Stable colour derived from the card name, used when the user hasn't picked one. */
export function autoColor(name: string): string {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

/** Black or white, whichever reads better on the given #rrggbb background (WCAG relative luminance). */
export function textColorOn(hex: string): '#000000' | '#ffffff' {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
