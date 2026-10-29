import { useLocation } from 'preact-iso';
import { PhotoScan } from '../components/PhotoScan';
import { TopBar } from '../components/TopBar';
import { setPendingBarcode, type PendingBarcode } from '../pending';

export function AddChooser() {
  const { route } = useLocation();

  function onDetected(barcode: PendingBarcode) {
    setPendingBarcode(barcode);
    route('/add/confirm');
  }

  return (
    <div class="page">
      <TopBar title="Add card" back="/" />
      <main class="content stack">
        <a class="choice" href="/add/scan">
          <strong>Scan with camera</strong>
          <span class="muted">Point your camera at the card’s barcode</span>
        </a>
        <PhotoScan onDetected={onDetected} />
        <a class="choice" href="/add/manual">
          <strong>Type it in</strong>
          <span class="muted">Enter the number printed under the barcode</span>
        </a>
      </main>
    </div>
  );
}
