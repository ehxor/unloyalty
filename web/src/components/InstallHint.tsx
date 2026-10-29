import { getMeta, setMeta } from '../db/meta';
import { isIOS, isStandalone } from '../lib/platform';
import { useLiveQuery } from '../lib/useLiveQuery';

/**
 * iOS Safari has no install prompt, and Safari is quicker to clear storage for sites than for
 * Home Screen apps, so tell iOS users running in a browser tab how to install.
 */
export function InstallHint() {
  const dismissed = useLiveQuery(async () => (await getMeta('a2hsDismissed')) ?? false, []);
  if (dismissed !== false || !isIOS() || isStandalone()) return null;
  return (
    <aside class="install-hint" aria-label="Install the app">
      <p>
        Install Unloyalty: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Installed, it opens offline and iOS is less
        likely to clear your cards.
      </p>
      <button type="button" class="icon-button small" aria-label="Dismiss" onClick={() => void setMeta('a2hsDismissed', true)}>
        ✕
      </button>
    </aside>
  );
}
