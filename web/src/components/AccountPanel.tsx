import { useEffect, useState } from 'preact/hooks';
import { buildExport, exportFilename } from '../db/exportImport';
import { getMeta } from '../db/meta';
import { saveFile } from '../lib/platform';
import { useLiveQuery } from '../lib/useLiveQuery';
import { ApiError, NetworkError } from '../sync/api';
import { syncNow } from '../sync/client';
import { fetchServerConfig, prepareSignOut, signIn, signOut, type SignInMode } from '../sync/session';
import { useSyncStatus, type SyncView } from '../sync/useSyncStatus';

function describe(s: SyncView): string {
  const when = s.lastSyncAt ? ` Last synced ${new Date(s.lastSyncAt).toLocaleString()}.` : '';
  switch (s.state) {
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return `Can’t reach the server.${s.pending ? ` ${s.pending} change${s.pending === 1 ? '' : 's'} will sync when it’s back.` : ''}${when}`;
    case 'error':
      return `Sync failed: ${s.error ?? 'unknown error'}.${when}`;
    default:
      return s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync.${when}` : `All cards are synced.${when}`;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof NetworkError) return 'Can’t reach the server. Check your connection and try again.';
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function SignInForm({ expiredUser }: { expiredUser?: string }) {
  const [username, setUsername] = useState(expiredUser ?? '');
  const [password, setPassword] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchServerConfig().then(
      (cfg) => setRegistrationOpen(cfg.registrationOpen),
      () => setRegistrationOpen(false),
    );
  }, []);

  async function submit(mode: SignInMode) {
    setBusy(true);
    setError(null);
    try {
      await signIn(mode, username, password, (previous) =>
        confirm(`This device has cards from “${previous}”. Remove them from this device and sign in as “${username.trim()}”?`),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit('login');
      }}
    >
      <p class="muted">
        {expiredUser
          ? `Your session for “${expiredUser}” ended. Sign in again to keep syncing; nothing on this device was removed.`
          : 'Sign in to back up your cards and sync them across your devices. Cards already on this device are added to your account.'}
      </p>
      <label class="field">
        <span>Username</span>
        <input name="username" value={username} onInput={(e) => setUsername(e.currentTarget.value)} autocomplete="username" autocapitalize="none" spellcheck={false} required />
      </label>
      <label class="field">
        <span>Password</span>
        <input name="password" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="current-password" required />
      </label>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
      <div class="actions">
        <button type="submit" class="primary" disabled={busy}>
          Sign in
        </button>
        {registrationOpen && (
          <button type="button" disabled={busy} onClick={() => void submit('register')}>
            Create account
          </button>
        )}
      </div>
    </form>
  );
}

function SignedIn({ username, status }: { username: string; status: SyncView }) {
  const [unsynced, setUnsynced] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSignOut() {
    setBusy(true);
    const pending = await prepareSignOut();
    setBusy(false);
    if (pending > 0) setUnsynced(pending);
    else await signOut();
  }

  async function exportFirst() {
    const file = await buildExport();
    await saveFile(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }), exportFilename());
  }

  return (
    <>
      <p>
        Signed in as <strong>{username}</strong>.
      </p>
      <p class="muted sync-state" aria-live="polite">
        {describe(status)}
      </p>
      {unsynced === null ? (
        <div class="actions">
          <button type="button" disabled={busy || status.state === 'syncing'} onClick={() => void syncNow()}>
            Sync now
          </button>
          <button type="button" disabled={busy} onClick={() => void startSignOut()}>
            Sign out
          </button>
        </div>
      ) : (
        <div class="warning" role="alertdialog" aria-label="Unsynced changes">
          <p>
            {unsynced} change{unsynced === 1 ? ' hasn’t' : 's haven’t'} reached the server. Signing out removes all cards from this device, so{' '}
            {unsynced === 1 ? 'it' : 'they'} will be lost.
          </p>
          <div class="actions">
            <button type="button" onClick={() => void exportFirst()}>
              Export first
            </button>
            <button type="button" class="danger" onClick={() => void signOut()}>
              Sign out anyway
            </button>
            <button type="button" class="ghost" onClick={() => setUnsynced(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function AccountPanel() {
  const status = useSyncStatus();
  const account = useLiveQuery(async () => ({ token: await getMeta('token'), user: await getMeta('user') }), []);
  if (!account || !status) return null;

  return (
    <section class="panel" aria-label="Account">
      <h2>Account &amp; sync</h2>
      {account.token && account.user ? (
        <SignedIn username={account.user.username} status={status} />
      ) : (
        <SignInForm key={account.user?.id ?? 'new'} expiredUser={account.user?.username} />
      )}
    </section>
  );
}
