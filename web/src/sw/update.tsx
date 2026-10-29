import { useLocation } from 'preact-iso';
import { useRegisterSW } from 'virtual:pwa-register/preact';

let registration: ServiceWorkerRegistration | undefined;

/** Ask the browser to look for a new service worker now. Resolves to false if there's no SW (dev, unsupported). */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) return false;
  await registration.update();
  return true;
}

/**
 * Registers the service worker and shows "new version available" when one is waiting.
 * Never shown on the checkout screen: reloading mid-scan would be worse than running an old version.
 */
export function UpdateToast() {
  const { path } = useLocation();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registration = r;
    },
  });

  if (!needRefresh || path.startsWith('/card/')) return null;
  return (
    <div class="toast" role="status">
      <span>A new version is available.</span>
      <button type="button" class="primary" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  );
}
