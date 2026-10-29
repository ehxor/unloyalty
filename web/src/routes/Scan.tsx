import { useLocation } from 'preact-iso';
import { useRef } from 'preact/hooks';
import { PhotoScan } from '../components/PhotoScan';
import { TopBar } from '../components/TopBar';
import { setPendingBarcode, type PendingBarcode } from '../pending';
import { useCameraScanner, type ScannerPhase } from '../scan/useCameraScanner';

interface ScanScreenProps {
  title: string;
  back: string;
  manualHref: string;
  onDetected: (barcode: PendingBarcode) => void;
}

const STATUS: Record<ScannerPhase, string> = {
  starting: 'Starting camera…',
  scanning: 'Point the camera at the barcode',
  paused: 'Camera paused',
  detected: 'Got it',
  error: 'Camera unavailable',
};

function ScanScreen({ title, back, manualHref, onDetected }: ScanScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanner = useCameraScanner(videoRef, onDetected);
  const failed = scanner.phase === 'error';

  return (
    <div class="page">
      <TopBar title={title} back={back} />
      <main class="content stack">
        <div class={`viewfinder ${scanner.phase}`} hidden={failed}>
          <video ref={videoRef} playsInline muted autoplay aria-label="Camera preview" />
          <div class="viewfinder-frame" aria-hidden="true" />
          {scanner.torchSupported && (
            <button type="button" class="torch" aria-pressed={scanner.torchOn} onClick={scanner.toggleTorch}>
              {scanner.torchOn ? 'Torch off' : 'Torch on'}
            </button>
          )}
        </div>

        {failed ? (
          <div class="camera-error" role="alert">
            <strong>{STATUS.error}</strong>
            <p>{scanner.error?.message}</p>
          </div>
        ) : (
          <p class="scan-status" role="status">
            {scanner.phase === 'scanning' && scanner.hint ? scanner.hint : STATUS[scanner.phase]}
          </p>
        )}

        <PhotoScan onDetected={onDetected} />
        <a class="choice" href={manualHref}>
          <strong>Type it in</strong>
          <span class="muted">Enter the number printed under the barcode</span>
        </a>
      </main>
    </div>
  );
}

export function AddScan() {
  const { route } = useLocation();
  return (
    <ScanScreen
      title="Scan card"
      back="/add"
      manualHref="/add/manual"
      onDetected={(barcode) => {
        setPendingBarcode(barcode);
        route('/add/confirm', true);
      }}
    />
  );
}

/** Replace an existing card's barcode; the edit form shows the new one before it's saved. */
export function RescanCard({ id }: { id: string }) {
  const { route } = useLocation();
  return (
    <ScanScreen
      title="Re-scan barcode"
      back={`/card/${id}/edit`}
      manualHref={`/card/${id}/edit`}
      onDetected={(barcode) => {
        setPendingBarcode(barcode, id);
        route(`/card/${id}/edit`, true);
      }}
    />
  );
}
