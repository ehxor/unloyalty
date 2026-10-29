import { useLocation } from 'preact-iso';
import { useEffect } from 'preact/hooks';
import { CardForm } from '../components/CardForm';
import { TopBar } from '../components/TopBar';
import { addCard, type CardInput } from '../db/cards';
import { getMeta, setMeta } from '../db/meta';
import { DEFAULT_FORMAT } from '../formats/formats';
import { requestPersistence } from '../lib/platform';
import { clearPendingBarcode, peekPendingBarcode } from '../pending';

function useSaveCard() {
  const { route } = useLocation();
  return async (input: CardInput) => {
    const card = await addCard(input);
    clearPendingBarcode();
    // First save is the moment the wallet has something worth protecting from eviction.
    if (!(await getMeta('persistRequested'))) {
      await setMeta('persistRequested', true);
      void requestPersistence();
    }
    route(`/card/${card.id}`, true);
  };
}

/** Manual entry: number, type and details on one screen. */
export function AddManual() {
  const save = useSaveCard();
  return (
    <div class="page">
      <TopBar title="Type it in" back="/add" />
      <main class="content">
        <CardForm initial={{ name: '', format: DEFAULT_FORMAT, value: '' }} barcodeEditable submitLabel="Save card" onSubmit={save} />
      </main>
    </div>
  );
}

/** After a scan: show what was detected so the user can verify it, then name the card. */
export function AddConfirm() {
  const save = useSaveCard();
  const { route } = useLocation();
  const pending = peekPendingBarcode();

  useEffect(() => {
    if (!pending) route('/add', true);
  }, [pending]);
  if (!pending) return null;

  return (
    <div class="page">
      <TopBar title="Name this card" back="/add" />
      <main class="content">
        <CardForm initial={{ name: '', ...pending }} barcodeEditable={false} submitLabel="Save card" onSubmit={save} />
      </main>
    </div>
  );
}
