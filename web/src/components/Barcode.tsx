import { useMemo } from 'preact/hooks';
import { FORMATS, type FormatId } from '../formats/formats';
import { renderSvg, svgDataUrl } from '../render/render';

/** Human-readable text printed under 1D barcodes (Codabar start/stop letters aren't printed on cards). */
export function humanReadable(format: FormatId, value: string): string {
  return format === 'codabar' ? value.slice(1, -1) : value;
}

interface Props {
  format: FormatId;
  value: string;
  /** Show the number under 1D barcodes. */
  showText?: boolean;
  class?: string;
}

export function Barcode({ format, value, showText = true, class: className }: Props) {
  const rendered = useMemo(() => {
    try {
      return { url: svgDataUrl(renderSvg(format, value)) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [format, value]);

  if ('error' in rendered) {
    return (
      <p class="barcode-error" role="alert">
        Can’t draw this barcode: {rendered.error}
      </p>
    );
  }
  const linear = FORMATS[format].linear;
  return (
    <figure class={`barcode ${linear ? 'barcode-1d' : 'barcode-2d'} ${className ?? ''}`}>
      <img src={rendered.url} alt={`${FORMATS[format].label} barcode`} draggable={false} />
      {linear && showText && <figcaption class="barcode-text">{humanReadable(format, value)}</figcaption>}
    </figure>
  );
}
