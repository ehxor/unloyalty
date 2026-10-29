import { useEffect, useState } from 'preact/hooks';
import { AccountPanel } from '../components/AccountPanel';
import { TopBar } from '../components/TopBar';
import { buildExport, exportFilename, importCards, parseExport } from '../db/exportImport';
import { requestPersistence, saveFile } from '../lib/platform';
import { checkForUpdate } from '../sw/update';

type Persistence = 'unsupported' | 'persisted' | 'best-effort';

async function readPersistence(): Promise<Persistence> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'persisted' : 'best-effort';
}

export function Settings() {
  const [persistence, setPersistence] = useState<Persistence | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [updateState, setUpdateState] = useState<string | null>(null);

  useEffect(() => {
    void readPersistence().then(setPersistence);
  }, []);

  async function onExport() {
    const file = await buildExport();
    await saveFile(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), exportFilename());
    setMessage({ text: `Exported ${file.cards.length} card${file.cards.length === 1 ? '' : 's'}.` });
  }

  async function onImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const { cards, invalid } = parseExport(await file.text());
      const s = await importCards(cards, invalid);
      const parts = [`${s.added} added`, `${s.updated} updated`, `${s.unchanged} unchanged`];
      if (s.invalid) parts.push(`${s.invalid} skipped as invalid`);
      setMessage({ text: `Import complete: ${parts.join(', ')}.` });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    }
  }

  async function onPersist() {
    await requestPersistence();
    setPersistence(await readPersistence());
  }

  async function onCheckUpdate() {
    setUpdateState('Checking…');
    try {
      setUpdateState((await checkForUpdate()) ? 'Up to date, or the update will be offered shortly.' : 'Updates aren’t available in this browser mode.');
    } catch {
      setUpdateState('Couldn’t reach the server to check.');
    }
  }

  return (
    <div class="page">
      <TopBar title="Settings" back="/" />
      <main class="content stack">
        <AccountPanel />
        <section class="panel">
          <h2>Backup</h2>
          <p class="muted">Export saves every card to a file. Import merges a file into this device; newer edits win.</p>
          <div class="actions">
            <button type="button" onClick={() => void onExport()}>
              Export cards
            </button>
            <label class="button">
              Import cards
              <input type="file" accept="application/json,.json" class="visually-hidden" onChange={onImport} />
            </label>
          </div>
          {message && (
            <p class={message.error ? 'form-error' : 'notice'} role="status">
              {message.text}
            </p>
          )}
        </section>

        <section class="panel">
          <h2>Storage</h2>
          {persistence === 'persisted' && <p>Cards are stored persistently on this device.</p>}
          {persistence === 'best-effort' && (
            <>
              <p>The browser may clear these cards if storage runs low or the app goes unused. Add the app to your Home Screen and keep an export as a backup.</p>
              <button type="button" onClick={() => void onPersist()}>
                Ask to keep data
              </button>
            </>
          )}
          {persistence === 'unsupported' && <p>This browser doesn’t report storage persistence. Keep an export as a backup.</p>}
        </section>

        <section class="panel">
          <h2>At the checkout</h2>
          <p class="muted">If a scanner struggles to read your screen, turn the screen brightness up. Web apps can’t change it for you.</p>
        </section>

        <section class="panel">
          <h2>About</h2>
          <p>
            Unloyalty <span class="mono">{__APP_VERSION__}</span>
          </p>
          <button type="button" onClick={() => void onCheckUpdate()}>
            Check for update
          </button>
          {updateState && <p class="muted">{updateState}</p>}
        </section>
      </main>
    </div>
  );
}
