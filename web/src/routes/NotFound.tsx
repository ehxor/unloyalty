import { TopBar } from '../components/TopBar';

export function NotFound() {
  return (
    <div class="page">
      <TopBar title="Not found" back="/" />
      <main class="content empty">
        <p>That card doesn’t exist on this device.</p>
        <a class="button" href="/">
          Back to wallet
        </a>
      </main>
    </div>
  );
}
