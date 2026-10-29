import { useEffect, useState } from 'preact/hooks';
import { Barcode } from '../components/Barcode';
import { markUsed } from '../db/cards';
import { db } from '../db/schema';
import { FORMATS } from '../formats/formats';
import { useLiveQuery } from '../lib/useLiveQuery';
import { useWakeLock } from '../lib/useWakeLock';
import { NotFound } from './NotFound';

/** The checkout screen: always black on white, regardless of theme. */
export function CardView({ id }: { id: string }) {
  const card = useLiveQuery(async () => (await db.cards.get(id)) ?? null, [id]);
  const [rotated, setRotated] = useState(false);
  useWakeLock();

  useEffect(() => {
    void markUsed(id);
  }, [id]);

  if (card === undefined) return <div class="checkout" />;
  if (card === null || card.deleted) return <NotFound />;

  const linear = FORMATS[card.format].linear;
  return (
    <div class={`checkout ${rotated ? 'rotated' : ''}`}>
      <header class="checkout-bar">
        <a class="icon-button" href="/" aria-label="Close">
          ✕
        </a>
        <h1>{card.name}</h1>
        <a class="icon-button" href={`/card/${card.id}/edit`} aria-label="Edit card">
          ✎
        </a>
      </header>
      <main class="checkout-body">
        <Barcode format={card.format} value={card.value} />
        {card.notes && !rotated && <p class="checkout-notes">{card.notes}</p>}
      </main>
      {linear && (
        <footer class="checkout-footer">
          <button type="button" class="ghost" aria-pressed={rotated} onClick={() => setRotated(!rotated)}>
            {rotated ? 'Upright' : 'Rotate'}
          </button>
        </footer>
      )}
    </div>
  );
}
