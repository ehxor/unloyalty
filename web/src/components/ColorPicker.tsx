import { autoColor, PALETTE } from '../lib/color';

interface Props {
  value: string | undefined;
  name: string;
  onChange: (color: string | undefined) => void;
}

export function ColorPicker({ value, name, onChange }: Props) {
  return (
    <div class="swatches" role="radiogroup" aria-label="Colour">
      <button
        type="button"
        role="radio"
        aria-checked={value === undefined}
        aria-label="Automatic colour"
        class="swatch swatch-auto"
        style={{ '--swatch': autoColor(name) }}
        onClick={() => onChange(undefined)}
      >
        A
      </button>
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          class="swatch"
          style={{ '--swatch': color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}
