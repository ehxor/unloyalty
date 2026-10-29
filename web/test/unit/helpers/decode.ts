import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { initDecoder } from '../../../src/scan/decoder';

const require = createRequire(import.meta.url);

/** Point zxing-wasm at the local WASM file; Node can't fetch the Vite asset URL. */
export function initNodeDecoder(): void {
  const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  initDecoder({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer });
}

/** Rasterise an SVG the way a screen would show it: 4 px per SVG unit, on white. */
export async function rasterise(svg: string): Promise<Uint8Array> {
  const png = await sharp(Buffer.from(svg), { density: 72 * 4 }).flatten({ background: '#ffffff' }).png().toBuffer();
  return new Uint8Array(png);
}
