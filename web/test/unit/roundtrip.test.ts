import { beforeAll, describe, expect, it } from 'vitest';
import { FORMAT_IDS, type FormatId } from '../../src/formats/formats';
import { renderSvg } from '../../src/render/render';
import { decodeImage } from '../../src/scan/decoder';
import { initNodeDecoder, rasterise } from './helpers/decode';

beforeAll(() => {
  initNodeDecoder();
});

const CASES: [FormatId, string][] = [
  ['code128', 'ABC-1234567890'],
  ['code128', '0000123'],
  ['code128', 'lower case ^~{}'],
  ['code128', '1234567890123456789012345678901234567890'],
  ['gs1_128', '(01)01234567890128(10)ABC(15)051231'],
  ['code39', 'CODE-39 TEST'],
  ['code39', 'ABC123$'],
  ['code39ext', 'abc+Def'],
  ['code93', 'CODE93TEST'],
  ['code93', 'Mixed case 93'],
  ['ean13', '5901234123457'],
  ['ean13', '4006381333931'],
  ['ean8', '96385074'],
  ['ean8', '00123457'],
  ['upca', '012345678905'],
  ['upca', '036000291452'],
  ['upce', '01234565'],
  ['upce', '04252614'],
  ['itf', '12345678'],
  ['itf', '00012345678905'],
  ['codabar', 'A40156B'],
  ['codabar', 'C1234-5678D'],
  ['qr', 'https://example.com/card?id=123'],
  ['qr', 'h\u00e9llo w\u00f6rld \u{1F44B}'],
  ['gs1_qr', '(01)01234567890128(10)ABC'],
  ['pdf417', 'PDF417 test 1234'],
  ['pdf417', 'h\u00e9llo w\u00f6rld'],
  ['aztec', 'Aztec test 42'],
  ['aztec', 'h\u00e9llo w\u00f6rld'],
  ['datamatrix', 'DataMatrix test'],
  ['datamatrix', 'h\u00e9llo w\u00f6rld'],
  ['gs1_datamatrix', '(01)01234567890128(10)ABC'],
];

describe('render → decode round-trip', () => {
  it('covers every format', () => {
    expect(new Set(CASES.map(([f]) => f))).toEqual(new Set(FORMAT_IDS));
  });

  it.each(CASES)('%s %j', async (format, value) => {
    const results = await decodeImage(await rasterise(renderSvg(format, value)));
    expect(results).toEqual([{ ok: true, format, value }]);
  });

  it('decodes a leading-zero EAN-13 as the identical UPC-A', async () => {
    const results = await decodeImage(await rasterise(renderSvg('ean13', '0012345678905')));
    expect(results).toEqual([{ ok: true, format: 'upca', value: '012345678905' }]);
  });
});
