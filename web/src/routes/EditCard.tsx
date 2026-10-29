import { useLocation } from 'preact-iso';
import { useEffect, useState } from 'preact/hooks';
import { CardForm } from '../components/CardForm';
import { TopBar } from '../components/TopBar';
import { deleteCard, updateCard, type CardInput } from '../db/cards';
import { db } from '../db/schema';
import { useLiveQuery } from '../lib/useLiveQuery';
import { clearPendingBarcode, peekPendingBarcode } from '../pending';
import { NotFound } from './NotFound';

export function EditCard({ id }: { id: string }) {
  const { route } = useLocation();
  // A barcode just re-scanned for this card replaces the stored one in the form; it's saved only on "Save changes".
  const [rescanned] = useState(() => peekPendingBarcode(id));
  useEffect(() => clearPendingBarcode(), []);
  // CardForm only reads `initial` on mount, so a sync landing mid-edit won't clobber what's being typed.
  const card = useLiveQuery(async () => (await db.cards.get(id)) ?? null, [id]);

  if (card === undefined) return null;
  if (card === null || card.deleted) return <NotFound />;

  async function save(input: CardInput) {
    await updateCard(id, input);
    route(`/card/${id}`, true);
  }

  async function remove() {
    if (!confirm(`Delete “${card!.name}”? This also removes it from your other devices.`)) return;
    await deleteCard(id);
    route('/', true);
  }

  const initial: CardInput = {
    name: card.name,
    format: rescanned?.format ?? card.format,
    value: rescanned?.value ?? card.value,
    ...(card.color ? { color: card.color } : {}),
    ...(card.notes ? { notes: card.notes } : {}),
  };

  return (
    <div class="page">
      <TopBar title="Edit card" back={`/card/${id}`} />
      <main class="content">
        <CardForm
          key={card.id}
          initial={initial}
          barcodeEditable
          submitLabel="Save changes"
          onSubmit={save}
          barcodeAction={
            rescanned ? (
              <p class="notice" role="status">
                New barcode scanned. Save changes to keep it.
              </p>
            ) : (
              <a class="button rescan" href={`/card/${id}/rescan`}>
                Re-scan barcode
              </a>
            )
          }
        >
          <button type="button" class="danger" onClick={remove}>
            Delete card
          </button>
        </CardForm>
      </main>
    </div>
  );
}
