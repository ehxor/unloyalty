import { useState } from 'preact/hooks';
import { InstallHint } from '../components/InstallHint';
import { ReorderList } from '../components/ReorderList';
import { SyncBadge } from '../components/SyncBadge';
import { TopBar } from '../components/TopBar';
import { activeCards, sortByRecent } from '../db/cards';
import { getMeta, setMeta, type MetaValues } from '../db/meta';
import type { Card } from '../db/schema';
import { autoColor, textColorOn } from '../lib/color';
import { useLiveQuery } from '../lib/useLiveQuery';

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function CardTile({ card }: { card: Card }) {
  const bg = card.color ?? autoColor(card.name);
  return (
    <li>
      <a class="tile" href={`/card/${card.id}`} style={{ '--tile': bg, '--tile-fg': textColorOn(bg) }}>
        <span class="tile-name">{card.name}</span>
      </a>
    </li>
  );
}

type SortMode = MetaValues['sortMode'];

function SortToggle({ mode }: { mode: SortMode }) {
  return (
    <div class="segmented" role="group" aria-label="Sort cards">
      {(['manual', 'recent'] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => void setMeta('sortMode', m)}>
          {m === 'manual' ? 'My order' : 'Recently used'}
        </button>
      ))}
    </div>
  );
}

export function Wallet() {
  const cards = useLiveQuery(activeCards, []);
  const sortMode: SortMode = useLiveQuery(async () => (await getMeta('sortMode')) ?? 'manual', []) ?? 'manual';
  const [query, setQuery] = useState('');
  const [reordering, setReordering] = useState(false);

  const q = fold(query.trim());
  const ordered = cards && sortMode === 'recent' ? sortByRecent(cards) : cards;
  const shown = ordered?.filter((c) => fold(c.name).includes(q));

  function body() {
    if (cards === undefined) return null;
    if (cards.length === 0) {
      return (
        <div class="empty">
          <p>No cards yet.</p>
          <p class="muted">Scan a loyalty card, library card or gym tag to keep it here — it works offline.</p>
          <a class="button primary" href="/add">
            Add card
          </a>
        </div>
      );
    }
    if (reordering) {
      return (
        <>
          <div class="toolbar">
            <p class="muted">Drag ⠿ or use the arrows to change the order.</p>
            <button type="button" class="primary" onClick={() => setReordering(false)}>
              Done
            </button>
          </div>
          <ReorderList cards={cards} />
        </>
      );
    }
    return (
      <>
        <input class="search" type="search" placeholder="Search cards" aria-label="Search cards" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <div class="toolbar">
          <SortToggle mode={sortMode} />
          {sortMode === 'manual' && cards.length > 1 && (
            <button
              type="button"
              class="ghost"
              onClick={() => {
                setQuery('');
                setReordering(true);
              }}
            >
              Reorder
            </button>
          )}
        </div>
        {shown!.length === 0 ? (
          <p class="muted center">No cards match “{query}”.</p>
        ) : (
          <ul class="grid" aria-label="Cards">
            {shown!.map((card) => (
              <CardTile key={card.id} card={card} />
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div class="page">
      <TopBar title="Unloyalty">
        <SyncBadge />
        <a class="icon-button" href="/settings" aria-label="Settings">
          ⚙
        </a>
      </TopBar>
      <main class="content">
        <InstallHint />
        {body()}
      </main>
      {cards !== undefined && cards.length > 0 && !reordering && (
        <a class="fab" href="/add" aria-label="Add card">
          +
        </a>
      )}
    </div>
  );
}
