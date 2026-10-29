import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { NAME_MAX, NOTES_MAX, validateCardInput, type CardInput } from '../db/cards';
import { FORMATS, MANUAL_FORMATS, type FormatId } from '../formats/formats';
import { normalizeValue } from '../formats/validate';
import { Barcode } from './Barcode';
import { ColorPicker } from './ColorPicker';

interface Props {
  initial: CardInput;
  /** Manual entry and edit let the user type the number; scans show the detected barcode read-only. */
  barcodeEditable: boolean;
  submitLabel: string;
  onSubmit: (input: CardInput) => Promise<void>;
  /** Rendered under the preview, e.g. a "Re-scan" link or a notice about a fresh scan. */
  barcodeAction?: ComponentChildren;
  children?: ComponentChildren;
}

export function CardForm({ initial, barcodeEditable, submitLabel, onSubmit, barcodeAction, children }: Props) {
  const [name, setName] = useState(initial.name);
  const [format, setFormat] = useState<FormatId>(initial.format);
  const [rawValue, setRawValue] = useState(initial.value);
  const [color, setColor] = useState(initial.color);
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalized = useMemo(() => normalizeValue(format, rawValue), [format, rawValue]);
  // Keep scanned/edited formats that aren't in the manual list selectable.
  const formatOptions = MANUAL_FORMATS.some((f) => f.id === format) ? MANUAL_FORMATS : [FORMATS[format], ...MANUAL_FORMATS];

  async function submit(event: Event) {
    event.preventDefault();
    setTouched(true);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    const input: CardInput = { name, format, value: normalized.value, ...(color ? { color } : {}), ...(notes.trim() ? { notes } : {}) };
    const invalid = validateCardInput(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(input);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form class="card-form" onSubmit={submit} noValidate>
      <section class="preview" aria-label="Barcode preview">
        {normalized.ok ? (
          <Barcode format={format} value={normalized.value} />
        ) : (
          <p class={touched || rawValue !== '' ? 'hint error' : 'hint'}>{rawValue === '' ? FORMATS[format].hint : normalized.error}</p>
        )}
      </section>
      {barcodeAction}

      {barcodeEditable ? (
        <>
          <label class="field">
            <span>Card number</span>
            <input
              name="value"
              value={rawValue}
              onInput={(e) => setRawValue(e.currentTarget.value)}
              inputMode={FORMATS[format].numeric ? 'numeric' : 'text'}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              required
            />
          </label>
          <label class="field">
            <span>Barcode type</span>
            <select name="format" value={format} onChange={(e) => setFormat(e.currentTarget.value as FormatId)}>
              {formatOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <dl class="detected">
          <dt>Type</dt>
          <dd>{FORMATS[format].label}</dd>
          <dt>Value</dt>
          <dd class="mono">{rawValue}</dd>
        </dl>
      )}

      <label class="field">
        <span>Name</span>
        <input
          name="name"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          maxLength={NAME_MAX}
          autocomplete="off"
          placeholder="e.g. Corner Shop"
          required
        />
      </label>

      <div class="field">
        <span>Colour</span>
        <ColorPicker value={color} name={name} onChange={setColor} />
      </div>

      <label class="field">
        <span>Notes</span>
        <textarea
          name="notes"
          value={notes}
          onInput={(e) => setNotes(e.currentTarget.value)}
          maxLength={NOTES_MAX}
          rows={2}
          placeholder="Optional, e.g. member since 2019"
        />
      </label>

      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}

      <div class="actions">
        <button type="submit" class="primary" disabled={busy}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}
