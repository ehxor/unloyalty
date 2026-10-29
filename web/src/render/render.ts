import {
  azteccode,
  code128,
  code39,
  code39ext,
  code93ext,
  datamatrix,
  drawingSVG,
  ean13,
  ean8,
  gs1_128,
  gs1datamatrix,
  gs1qrcode,
  interleaved2of5,
  pdf417,
  qrcode,
  rationalizedCodabar,
  upca,
  upce,
  type DrawingContext,
  type RenderOptions,
} from 'bwip-js';
import { FORMATS, type FormatId } from '../formats/formats';

type Encoder = (opts: RenderOptions, drawing: DrawingContext<string>) => string;

// Named encoder imports keep the bundle to the symbologies we actually use.
const ENCODERS: Record<FormatId, Encoder> = {
  code128,
  gs1_128,
  code39,
  code39ext,
  code93: code93ext,
  ean13,
  ean8,
  upca,
  upce,
  itf: interleaved2of5,
  codabar: rationalizedCodabar,
  qr: qrcode,
  gs1_qr: gs1qrcode,
  pdf417,
  aztec: azteccode,
  datamatrix,
  gs1_datamatrix: gs1datamatrix,
};

/** Bar height for 1D symbols, in mm at scale 1. */
const LINEAR_HEIGHT_MM = 20;

/**
 * Render a stored value as a black-on-white SVG with the format's quiet zone baked in.
 * Throws with bwip-js's message when the value can't be encoded.
 */
export function renderSvg(format: FormatId, value: string): string {
  const spec = FORMATS[format];
  const opts: RenderOptions = {
    bcid: spec.bcid,
    text: value,
    scale: 1,
    includetext: false,
    paddingwidth: spec.quietZone,
    paddingheight: spec.linear ? 4 : spec.quietZone,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
    ...(spec.linear ? { height: LINEAR_HEIGHT_MM } : {}),
    ...spec.encoderOptions,
  };
  const svg = ENCODERS[format](opts, drawingSVG());
  return svg.replace('<svg ', '<svg shape-rendering="crispEdges" ');
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
