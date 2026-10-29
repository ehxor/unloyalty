import { gtinCheckDigit, hasValidGtinCheck, upcEToUpcA } from './checksum';
import type { FormatId } from './formats';

export type ValueResult = { ok: true; value: string } | { ok: false; error: string };

const MAX_LINEAR = 200;
const MAX_MATRIX = 2000;

const ok = (value: string): ValueResult => ({ ok: true, value });
const fail = (error: string): ValueResult => ({ ok: false, error });

function digitsOnly(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

function gtin(raw: string, label: string, length: number): ValueResult {
  const v = digitsOnly(raw);
  if (!/^\d+$/.test(v)) return fail(`${label} uses digits only`);
  if (v.length === length - 1) return ok(v + gtinCheckDigit(v));
  if (v.length !== length) return fail(`${label} needs ${length - 1} or ${length} digits`);
  if (!hasValidGtinCheck(v)) return fail(`${label} check digit is wrong (expected ${gtinCheckDigit(v.slice(0, -1))})`);
  return ok(v);
}

function upce(raw: string): ValueResult {
  const v = digitsOnly(raw);
  if (!/^\d+$/.test(v)) return fail('UPC-E uses digits only');
  let body: string;
  if (v.length === 6) body = '0' + v;
  else if (v.length === 7 || v.length === 8) body = v.slice(0, 7);
  else return fail('UPC-E needs 6, 7 or 8 digits');
  if (body[0] !== '0' && body[0] !== '1') return fail('UPC-E must start with 0 or 1');
  const check = gtinCheckDigit(upcEToUpcA(body + '0').slice(0, 11));
  if (v.length === 8 && v[7] !== check) return fail(`UPC-E check digit is wrong (expected ${check})`);
  return ok(body + check);
}

const GS1_RE = /^(\(\d{2,4}\)[^()]+)+$/;

/**
 * Normalise a user-entered or scanned value for a format, or explain why it can't be encoded.
 * Numeric formats tolerate spaces/dashes and fill in a missing check digit.
 */
export function normalizeValue(format: FormatId, raw: string): ValueResult {
  if (raw.trim() === '') return fail('Enter the card number');
  switch (format) {
    case 'code128':
      if (!/^[\x20-\x7e]+$/.test(raw)) return fail('Code 128 supports plain ASCII letters, digits and symbols only');
      return raw.length > MAX_LINEAR ? fail('Too long for a Code 128 barcode') : ok(raw);
    case 'gs1_128':
    case 'gs1_qr':
    case 'gs1_datamatrix':
      return GS1_RE.test(raw.trim()) ? ok(raw.trim()) : fail('GS1 data must look like (01)12345678901231(10)ABC');
    case 'code39': {
      const v = raw.toUpperCase();
      if (!/^[0-9A-Z \-.$/+%]+$/.test(v)) return fail('Code 39 supports A–Z, 0–9, space and - . $ / + % only');
      return v.length > MAX_LINEAR ? fail('Too long for a Code 39 barcode') : ok(v);
    }
    case 'code39ext':
    case 'code93':
      if (!/^[\x00-\x7f]+$/.test(raw)) return fail('Only ASCII characters are supported');
      return raw.length > MAX_LINEAR ? fail('Too long for this barcode') : ok(raw);
    case 'ean13':
      return gtin(raw, 'EAN-13', 13);
    case 'ean8':
      return gtin(raw, 'EAN-8', 8);
    case 'upca':
      return gtin(raw, 'UPC-A', 12);
    case 'upce':
      return upce(raw);
    case 'itf': {
      const v = digitsOnly(raw);
      if (!/^\d+$/.test(v)) return fail('ITF uses digits only');
      if (v.length % 2 !== 0) return fail('ITF needs an even number of digits');
      return v.length > MAX_LINEAR ? fail('Too long for an ITF barcode') : ok(v);
    }
    case 'codabar': {
      const v = raw.replace(/\s/g, '').toUpperCase();
      const inner = /^[0-9\-$:/.+]+$/;
      if (/^[A-D].*[A-D]$/.test(v) && v.length >= 3 && inner.test(v.slice(1, -1))) return ok(v);
      if (inner.test(v)) return ok(`A${v}A`);
      return fail('Codabar supports digits and - $ : / . + with optional A–D start/stop letters');
    }
    case 'qr':
    case 'pdf417':
    case 'aztec':
    case 'datamatrix':
      return raw.length > MAX_MATRIX ? fail('Too long for this barcode') : ok(raw);
  }
}
