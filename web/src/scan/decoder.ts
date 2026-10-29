import { prepareZXingModule, readBarcodes, type ReaderOptions, type ReadResult, type ZXingModuleOverrides } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { DECODER_FORMATS, fromDecoded, type DecodeMapping } from '../formats/fromDecoder';

export type DecodeInput = Blob | ImageData | Uint8Array;

let prepared = false;

/** Load the bundled WASM (never a CDN). Tests pass `wasmBinary` instead of a URL. */
export function initDecoder(overrides?: ZXingModuleOverrides): void {
  prepareZXingModule({
    overrides: overrides ?? { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    fireImmediately: false,
  });
  prepared = true;
}

const BASE_OPTIONS: ReaderOptions = {
  formats: [...DECODER_FORMATS],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  textMode: 'Plain',
  maxNumberOfSymbols: 4,
};

/**
 * Decode every barcode in an image and map each to a storable (format, value).
 * GS1 symbols are re-read in HRI text mode so their value keeps the "(AI)" structure needed to re-render them.
 */
export async function decodeImage(input: DecodeInput, options: Partial<ReaderOptions> = {}): Promise<DecodeMapping[]> {
  if (!prepared) initDecoder();
  const results = (await readBarcodes(input, { ...BASE_OPTIONS, ...options })).filter((r) => r.isValid);
  if (results.length === 0) return [];

  let hri: ReadResult[] = [];
  if (results.some((r) => r.contentType === 'GS1')) {
    hri = (await readBarcodes(input, { ...BASE_OPTIONS, ...options, textMode: 'HRI' })).filter((r) => r.isValid);
  }

  const seen = new Set<string>();
  const out: DecodeMapping[] = [];
  for (const r of results) {
    const text = r.contentType === 'GS1' ? hri.find((h) => h.format === r.format && h.contentType === 'GS1')?.text : r.text;
    if (text === undefined) continue;
    const mapped = fromDecoded({ format: r.format, text, symbologyIdentifier: r.symbologyIdentifier, contentType: r.contentType });
    const key = mapped.ok ? `${mapped.format}\u0000${mapped.value}` : `!${mapped.error}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}
