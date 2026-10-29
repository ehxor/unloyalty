import { useState } from 'preact/hooks';
import { FORMATS } from '../formats/formats';
import type { DecodeMapping } from '../formats/fromDecoder';
import type { PendingBarcode } from '../pending';
import { decodeImage } from '../scan/decoder';

interface Props {
  onDetected: (barcode: PendingBarcode) => void;
}

/** "Scan from photo": decode a picked image; works without camera permission and for screenshots. */
export function PhotoScan({ onDetected }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<PendingBarcode[]>([]);

  async function onPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setChoices([]);
    let results: DecodeMapping[];
    try {
      results = await decodeImage(file);
    } catch (err) {
      setBusy(false);
      setError(`Couldn’t read that image (${err instanceof Error ? err.message : String(err)})`);
      return;
    }
    setBusy(false);
    const found = results.flatMap((r) => (r.ok ? [{ format: r.format, value: r.value }] : []));
    if (found.length === 1) return onDetected(found[0]!);
    if (found.length > 1) return setChoices(found);
    const unsupported = results.find((r) => !r.ok);
    setError(unsupported && !unsupported.ok ? unsupported.error : 'No barcode found. Try a sharper, closer photo, or type the number in.');
  }

  return (
    <>
      <label class={`choice ${busy ? 'busy' : ''}`}>
        <strong>{busy ? 'Reading photo…' : 'Scan from photo'}</strong>
        <span class="muted">Pick a photo or screenshot of the barcode</span>
        <input type="file" accept="image/*" class="visually-hidden" onChange={onPhoto} disabled={busy} />
      </label>

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      {choices.length > 0 && (
        <section>
          <h2>Several barcodes found</h2>
          <ul class="list">
            {choices.map((c) => (
              <li key={`${c.format}:${c.value}`}>
                <button type="button" class="list-button" onClick={() => onDetected(c)}>
                  <span>{FORMATS[c.format].label}</span>
                  <span class="mono">{c.value}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
