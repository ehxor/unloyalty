import { describe, expect, it } from 'vitest';
import { gtinCheckDigit, upcAToUpcE, upcEToUpcA } from '../../src/formats/checksum';
import type { FormatId } from '../../src/formats/formats';
import { normalizeValue } from '../../src/formats/validate';

describe('normalizeValue', () => {
  it.each<[FormatId, string, string]>([
    ['ean13', '590123412345', '5901234123457'],
    ['ean13', '590 1234 12345 7', '5901234123457'],
    ['ean8', '9638507', '96385074'],
    ['upca', '03600029145', '036000291452'],
    ['upce', '123456', '01234565'],
    ['upce', '0123456', '01234565'],
    ['itf', '1234-5678', '12345678'],
    ['codabar', '40156', 'A40156A'],
    ['codabar', 'a40156b', 'A40156B'],
    ['code39', 'abc-1', 'ABC-1'],
    ['code128', ' padded ', ' padded '],
  ])('%s %j → %j', (format, raw, expected) => {
    expect(normalizeValue(format, raw)).toEqual({ ok: true, value: expected });
  });

  it.each<[FormatId, string, RegExp]>([
    ['ean13', '5901234123458', /check digit is wrong \(expected 7\)/],
    ['ean13', '59012341234', /12 or 13 digits/],
    ['upca', '036000291453', /check digit/],
    ['upce', '01234566', /expected 5/],
    ['upce', '21234565', /start with 0 or 1/],
    ['itf', '123', /even number/],
    ['code39', 'a_b', /Code 39 supports/],
    ['code128', 'caf\u00e9', /ASCII/],
    ['codabar', 'A12', /Codabar supports/],
    ['gs1_128', '0101234567890128', /GS1 data/],
    ['qr', '   ', /Enter the card number/],
  ])('%s %j rejected', (format, raw, error) => {
    const result = normalizeValue(format, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });
});

describe('UPC-E ⇄ UPC-A', () => {
  // One vector per expansion rule (last UPC-E data digit 0–2, 3, 4, 5–9); check digit computed from the UPC-A body.
  it.each([
    ['0123450', '01200000345'],
    ['0123453', '01230000045'],
    ['0123454', '01234000005'],
    ['1123457', '11234500007'],
    ['0425261', '04210000526'],
  ])('%s ⇄ %s', (upceBody, upcaBody) => {
    const check = gtinCheckDigit(upcaBody);
    expect(upcEToUpcA(upceBody + check)).toBe(upcaBody + check);
    expect(upcAToUpcE(upcaBody + check)).toBe(upceBody + check);
  });

  it('refuses UPC-A codes that are not zero-suppressible', () => {
    expect(upcAToUpcE('036000291452')).toBeNull();
  });
});
