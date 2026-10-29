import { upcAToUpcE } from './checksum';
import type { FormatId } from './formats';
import { normalizeValue } from './validate';

/** The subset of a zxing-wasm ReadResult we depend on. */
export interface DecodedSymbol {
  format: string;
  text: string;
  symbologyIdentifier: string;
  contentType: string;
}

export type DecodeMapping = { ok: true; format: FormatId; value: string } | { ok: false; error: string };

/** Formats passed to zxing-wasm's reader; symbology names include their variants (e.g. Code39Ext). */
export const DECODER_FORMATS = ['Codabar', 'Code39', 'Code93', 'Code128', 'ITF', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'QRCode', 'PDF417', 'Aztec', 'DataMatrix'] as const;

const isGs1 = (s: DecodedSymbol) => s.contentType === 'GS1';

function formatFor(s: DecodedSymbol): FormatId | null {
  switch (s.format) {
    case 'Code128':
      return isGs1(s) ? 'gs1_128' : 'code128';
    case 'Code39':
    case 'Code39Std':
      return 'code39';
    case 'Code39Ext':
      return 'code39ext';
    case 'Code93':
      return 'code93';
    case 'EAN13':
      // A leading-zero EAN-13 and a UPC-A are the same bars; zxing reports either. Canonicalise to UPC-A.
      return s.text.startsWith('0') ? 'upca' : 'ean13';
    case 'UPCA':
      return 'upca';
    case 'EAN8':
      return 'ean8';
    case 'UPCE':
      return 'upce';
    case 'ITF':
    case 'ITF14':
      return 'itf';
    case 'Codabar':
      return 'codabar';
    case 'QRCode':
    case 'QRCodeModel2':
      return isGs1(s) ? 'gs1_qr' : 'qr';
    case 'PDF417':
      return 'pdf417';
    case 'Aztec':
    case 'AztecCode':
      return 'aztec';
    case 'DataMatrix':
      return isGs1(s) ? 'gs1_datamatrix' : 'datamatrix';
    default:
      return null;
  }
}

/**
 * Map a decoded symbol to the stored (format, value) pair such that rendering it reproduces equivalent bars.
 * GS1 symbols must be decoded with textMode "HRI" so `text` is the bracketed "(01)…" form.
 */
export function fromDecoded(s: DecodedSymbol): DecodeMapping {
  const format = formatFor(s);
  if (!format) return { ok: false, error: `${s.format} barcodes aren't supported yet` };
  if (s.contentType === 'Binary') return { ok: false, error: 'This barcode contains binary data, which isn\u2019t supported' };

  let raw = s.text;
  if (format === 'upca' && raw.length === 13) raw = raw.slice(1);
  if (format === 'upce') {
    // zxing reports UPC-E expanded to 13 digits; store the 8-digit form so it re-renders as UPC-E.
    const upca = raw.length === 13 ? raw.slice(1) : raw;
    const compressed = raw.length === 8 ? raw : upcAToUpcE(upca);
    if (!compressed) return { ok: false, error: 'Could not read this UPC-E barcode' };
    raw = compressed;
  }

  const result = normalizeValue(format, raw);
  if (!result.ok) return result;
  if (result.value !== raw) return { ok: false, error: 'The barcode data didn\u2019t pass validation' };
  return { ok: true, format, value: result.value };
}
