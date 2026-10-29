/**
 * Single source of truth for barcode formats. IDs are persisted and synced: never rename one.
 * `bcid` is the bwip-js encoder used to re-render the stored value.
 */
export const FORMAT_IDS = [
  'code128',
  'gs1_128',
  'code39',
  'code39ext',
  'code93',
  'ean13',
  'ean8',
  'upca',
  'upce',
  'itf',
  'codabar',
  'qr',
  'gs1_qr',
  'pdf417',
  'aztec',
  'datamatrix',
  'gs1_datamatrix',
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];

export type Bcid =
  | 'code128'
  | 'gs1-128'
  | 'code39'
  | 'code39ext'
  | 'code93ext'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'interleaved2of5'
  | 'rationalizedCodabar'
  | 'qrcode'
  | 'gs1qrcode'
  | 'pdf417'
  | 'azteccode'
  | 'datamatrix'
  | 'gs1datamatrix';

export interface FormatSpec {
  id: FormatId;
  label: string;
  bcid: Bcid;
  linear: boolean;
  /** Quiet zone each side, in bwip-js units at scale 1 (1D: 1 unit = 1 module; 2D: 2 units = 1 module). */
  quietZone: number;
  /** Extra encoder options required for a faithful re-render. */
  encoderOptions?: Record<string, string | number | boolean>;
  /** Shown in the manual-entry format picker. */
  manual: boolean;
  /** Short hint for manual entry. */
  hint: string;
  /** Digits only: manual entry shows a numeric keypad. */
  numeric?: true;
}

export const FORMATS: Record<FormatId, FormatSpec> = {
  code128: { id: 'code128', label: 'Code 128', bcid: 'code128', linear: true, quietZone: 10, manual: true, hint: 'Letters, digits and symbols' },
  gs1_128: { id: 'gs1_128', label: 'GS1-128', bcid: 'gs1-128', linear: true, quietZone: 10, manual: false, hint: 'GS1 data, e.g. (01)…(10)…' },
  code39: { id: 'code39', label: 'Code 39', bcid: 'code39', linear: true, quietZone: 10, manual: true, hint: 'A–Z, 0–9, space and - . $ / + %' },
  code39ext: { id: 'code39ext', label: 'Code 39 (full ASCII)', bcid: 'code39ext', linear: true, quietZone: 10, manual: false, hint: 'Any ASCII text' },
  code93: { id: 'code93', label: 'Code 93', bcid: 'code93ext', linear: true, quietZone: 10, encoderOptions: { includecheck: true }, manual: true, hint: 'Any ASCII text' },
  ean13: { id: 'ean13', label: 'EAN-13', bcid: 'ean13', linear: true, quietZone: 10, manual: true, hint: '12 or 13 digits', numeric: true },
  ean8: { id: 'ean8', label: 'EAN-8', bcid: 'ean8', linear: true, quietZone: 10, manual: true, hint: '7 or 8 digits', numeric: true },
  upca: { id: 'upca', label: 'UPC-A', bcid: 'upca', linear: true, quietZone: 10, manual: true, hint: '11 or 12 digits', numeric: true },
  upce: { id: 'upce', label: 'UPC-E', bcid: 'upce', linear: true, quietZone: 10, manual: true, hint: '6, 7 or 8 digits', numeric: true },
  itf: { id: 'itf', label: 'ITF (Interleaved 2 of 5)', bcid: 'interleaved2of5', linear: true, quietZone: 10, manual: true, hint: 'An even number of digits', numeric: true },
  codabar: { id: 'codabar', label: 'Codabar', bcid: 'rationalizedCodabar', linear: true, quietZone: 10, manual: true, hint: 'Digits and - $ : / . +, optional A–D start/stop' },
  qr: { id: 'qr', label: 'QR code', bcid: 'qrcode', linear: false, quietZone: 8, manual: true, hint: 'Any text' },
  gs1_qr: { id: 'gs1_qr', label: 'GS1 QR code', bcid: 'gs1qrcode', linear: false, quietZone: 8, manual: false, hint: 'GS1 data, e.g. (01)…(10)…' },
  pdf417: { id: 'pdf417', label: 'PDF417', bcid: 'pdf417', linear: false, quietZone: 4, manual: true, hint: 'Any text' },
  aztec: { id: 'aztec', label: 'Aztec', bcid: 'azteccode', linear: false, quietZone: 4, manual: true, hint: 'Any text' },
  datamatrix: { id: 'datamatrix', label: 'Data Matrix', bcid: 'datamatrix', linear: false, quietZone: 4, manual: true, hint: 'Any text' },
  gs1_datamatrix: { id: 'gs1_datamatrix', label: 'GS1 Data Matrix', bcid: 'gs1datamatrix', linear: false, quietZone: 4, manual: false, hint: 'GS1 data, e.g. (01)…(10)…' },
};

export const DEFAULT_FORMAT: FormatId = 'code128';

export function isFormatId(value: unknown): value is FormatId {
  return typeof value === 'string' && (FORMAT_IDS as readonly string[]).includes(value);
}

export const MANUAL_FORMATS: readonly FormatSpec[] = FORMAT_IDS.map((id) => FORMATS[id]).filter((f) => f.manual);
