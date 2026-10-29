import { useState } from 'preact/hooks';
import { moveCard } from '../db/cards';
import type { Card } from '../db/schema';
import { autoColor } from '../lib/color';

interface Drag {
  id: string;
  from: number;
  startY: number;
  dy: number;
  /** Height of one row including the gap, measured at drag start. */
  step: number;
}

/** Index the dragged row would land on for a given vertical offset. */
function targetIndex(drag: Drag, count: number): number {
  return Math.max(0, Math.min(count - 1, drag.from + Math.round(drag.dy / drag.step)));
}

/**
 * Wallet order editor: drag a row by its handle, or use the up/down buttons (keyboard and screen readers).
 * Rows between the old and new position slide out of the way while dragging.
 */
export function ReorderList({ cards }: { cards: Card[] }) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const target = drag ? targetIndex(drag, cards.length) : -1;

  function start(event: PointerEvent, index: number, id: string) {
    const row = (event.currentTarget as HTMLElement).closest('li');
    const next = row?.nextElementSibling ?? row?.previousElementSibling;
    if (!row) return;
    const step = next ? Math.abs(next.getBoundingClientRect().top - row.getBoundingClientRect().top) : row.offsetHeight;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDrag({ id, from: index, startY: event.clientY, dy: 0, step });
  }

  function move(event: PointerEvent) {
    if (drag) setDrag({ ...drag, dy: event.clientY - drag.startY });
  }

  function end() {
    if (!drag) return;
    const to = targetIndex(drag, cards.length);
    setDrag(null);
    if (to !== drag.from) void moveCard(drag.id, to);
  }

  function offsetFor(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) return drag.dy;
    if (drag.from < index && index <= target) return -drag.step;
    if (target <= index && index < drag.from) return drag.step;
    return 0;
  }

  return (
    <ol class={`reorder ${drag ? 'dragging' : ''}`} aria-label="Card order">
      {cards.map((card, index) => (
        <li
          key={card.id}
          class={drag?.id === card.id ? 'lifted' : ''}
          style={{ transform: `translateY(${offsetFor(index)}px)` }}
        >
          <span class="reorder-dot" style={{ '--tile': card.color ?? autoColor(card.name) }} aria-hidden="true" />
          <span class="reorder-name">{card.name}</span>
          <button type="button" class="icon-button small" aria-label={`Move ${card.name} up`} disabled={index === 0} onClick={() => void moveCard(card.id, index - 1)}>
            ▲
          </button>
          <button
            type="button"
            class="icon-button small"
            aria-label={`Move ${card.name} down`}
            disabled={index === cards.length - 1}
            onClick={() => void moveCard(card.id, index + 1)}
          >
            ▼
          </button>
          <span
            class="drag-handle"
            aria-hidden="true"
            data-handle={card.name}
            onPointerDown={(e) => start(e, index, card.id)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => setDrag(null)}
          >
            ⠿
          </span>
        </li>
      ))}
    </ol>
  );
}
