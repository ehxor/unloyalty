# Handoff: Self-Hosted Loyalty Card Wallet (PWA)

## 1. Summary

Build a **progressive web app** that stores barcodes from loyalty cards, library cards, gym tags and anything else with a barcode. The user scans a card with their phone camera (or types the number), gives it a name, and it appears in their wallet. Opening a card shows a large, scannable barcode at the checkout.

Constraints:

- **PWA only.** No native app, no App Store. Primary target is **iPhone (iOS Safari, installed to Home Screen)**; Android Chrome must also work.
- **Offline-first.** Saved cards must open and display with no network at all.
- **Self-hosted backend in a container**, run on the user's home server or wherever they like. It must be **lightweight** (target: under 25 MB image, under 30 MB RAM idle, runs on a Raspberry Pi).
- No third-party services, no telemetry, no analytics, no external CDNs at runtime. The user owns their data.

## 2. Architecture decision

**Local-first client + optional tiny sync server.**

- The phone is the source of truth for display. All cards live in IndexedDB on the device; the app never needs the server to show a card.
- The server does two jobs: **serves the PWA** (so it has a stable HTTPS origin) and **syncs/backs up cards** across a user's devices.
- If the server is unreachable, the app works normally and queues changes until it can sync.

```
┌───────────── Phone (PWA) ─────────────┐        ┌──── Container ────┐
│ UI (Preact)                           │        │ Go single binary  │
│ Scanner (zxing-wasm, camera)          │ HTTPS  │  - static PWA     │
│ Renderer (bwip-js)                    │◄──────►│  - /api/* sync    │
│ IndexedDB (Dexie) ◄─ source of truth  │        │  - SQLite file    │
│ Service worker (precache app shell)   │        └───────────────────┘
└───────────────────────────────────────┘
```

## 3. Tech stack

### Frontend
| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | |
| Build | Vite | Fast, simple, good PWA plugin |
| UI | Preact + preact-iso (or React if preferred; keep bundle small) | Small bundle, familiar API |
| PWA | `vite-plugin-pwa` (Workbox, `injectManifest` or `generateSW`) | Precaching + manifest generation |
| Storage | IndexedDB via **Dexie** | Reliable, simple schema versioning |
| Scanning | **`zxing-wasm`** (zxing-cpp compiled to WASM) | Works on iOS Safari, many formats. Feature-detect native `BarcodeDetector` and prefer it where available (Android Chrome); fall back to zxing-wasm. Do not assume `BarcodeDetector` exists on iOS. |
| Rendering | **`bwip-js`** | Renders every format we scan (1D and 2D) to canvas/SVG, fully offline |
| Styling | Plain CSS with custom properties (no framework required) | |
| Tests | Vitest (unit), Playwright (e2e incl. offline mode) | |

The WASM file for zxing must be **bundled and precached locally**, never loaded from a CDN.

### Backend
| Concern | Choice | Why |
|---|---|---|
| Language | **Go** (latest stable) | Single static binary, tiny memory footprint |
| HTTP | stdlib `net/http` (Go 1.22+ routing) | No framework needed |
| DB | SQLite via **`modernc.org/sqlite`** (pure Go, no cgo) | Easy cross-compile, one file to back up |
| Static assets | `embed` the built PWA into the binary | One artifact to ship |
| Auth | Password → bcrypt; session = random opaque token stored hashed in DB; sent as `Authorization: Bearer` | Simple, no JWT needed |
| Container | Multi-stage build → `gcr.io/distroless/static` (or `scratch`) | Tiny, minimal attack surface |
| Arch | Multi-arch image: `linux/amd64`, `linux/arm64` | Home servers and Raspberry Pi |

## 4. Features (MVP)

### 4.1 Wallet (home screen)
- Grid/list of cards showing name and a colour tile (user-picked or auto-assigned from name).
- Search/filter by name.
- Sort: manual order (drag to reorder), plus "recently used" option.
- Empty state with a clear "Add card" button.
- Sync status indicator (synced / pending changes / offline / no server configured).

### 4.2 Add card
Three ways in, all ending at the same "Name this card" form:
1. **Camera scan** — live camera preview, continuous decode, haptic/visual confirmation on success. Use rear camera (`facingMode: "environment"`). Torch toggle where supported.
2. **Scan from photo** — `<input type="file" accept="image/*">` decoded with zxing-wasm. Important fallback for iOS camera quirks and for cards the user has a screenshot of.
3. **Manual entry** — type the number and pick the format (default Code 128; offer the common formats).

After a scan, show the detected **format and raw value** so the user can verify, then:
- Name (required), colour (optional), notes (optional, e.g. "member since 2019", PIN hint).
- Save → card appears in the wallet.

Supported formats (minimum): Code 128, Code 39, Code 93, EAN-13, EAN-8, UPC-A, UPC-E, ITF, Codabar, QR, PDF417, Aztec, Data Matrix.

**Store the exact decoded format and raw value.** Re-rendering must reproduce a barcode the store's scanner accepts. Watch for: UPC-A vs EAN-13 (zxing may report one as the other), check digits, and leading zeros. Write tests for round-trip (render → decode → same value and format).

### 4.3 View card (the checkout screen)
- Full-width barcode on a **pure white background**, maximum size for the format, adequate quiet zone, crisp rendering (SVG or device-pixel-ratio-aware canvas).
- Human-readable number below 1D barcodes.
- Card name at top, minimal chrome.
- Request a **Screen Wake Lock** while open (feature-detect; ignore failure).
- Web apps can't set screen brightness; add a one-line hint in settings ("turn brightness up if a scanner struggles") rather than pretending.
- Optional: rotate 1D barcodes to landscape via a "rotate" toggle for long Code 128 values.
- Updates "last used" timestamp.

### 4.4 Edit / delete
- Edit name, colour, notes. Allow re-scan to replace the barcode.
- Delete with confirmation; deletions sync as tombstones.

### 4.5 Settings
- Server URL is the app's own origin (see §6); show connection and account status.
- Log in / log out / create account (if registration enabled on server).
- **Export** all cards to a JSON file; **Import** from JSON (merge by card ID). This must work with no server.
- Request persistent storage (`navigator.storage.persist()`) on first card save and show the result.
- App version and "check for update" (service worker update flow).

### 4.6 Out of scope for MVP (nice later)
- Card photos (front/back image).
- Sharing a card with another user/household member.
- Import from other wallet apps (e.g. Catima/Stocard exports).
- Location/geofence reminders (not reliably possible in an iOS PWA anyway).

## 5. Data model

### Client (Dexie)
```ts
interface Card {
  id: string;            // UUIDv7, generated client-side
  name: string;
  format: BarcodeFormat; // enum string, e.g. "code128", "ean13", "qr"
  value: string;         // exact decoded payload
  color?: string;        // hex
  notes?: string;
  sortOrder: number;
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601, set on every local change
  lastUsedAt?: string;
  deleted: boolean;      // tombstone
  dirty: boolean;        // local change not yet acknowledged by server
}
```
Plus a `meta` table: `{ key: "syncCursor", value: number }`, auth token, user prefs.

### Server (SQLite)
```sql
users(id TEXT PK, username TEXT UNIQUE, password_hash TEXT, created_at TEXT)
sessions(token_hash TEXT PK, user_id TEXT, created_at TEXT, last_seen_at TEXT, user_agent TEXT)
cards(
  id TEXT PK, user_id TEXT, name TEXT, format TEXT, value TEXT,
  color TEXT, notes TEXT, sort_order REAL,
  created_at TEXT, updated_at TEXT, last_used_at TEXT,
  deleted INTEGER, server_rev INTEGER   -- monotonic per server
)
CREATE INDEX cards_user_rev ON cards(user_id, server_rev);
```
Use WAL mode. Run schema migrations at startup (embedded SQL files, numbered).

## 6. Sync protocol

Keep it simple: **per-card last-write-wins on `updatedAt`**, with a server revision cursor.

- `POST /api/sync`
  - Request: `{ cursor: number, changes: Card[] }` (all dirty cards)
  - Server, in one transaction: for each incoming card, upsert if `incoming.updatedAt > stored.updatedAt` (or not stored). Every write bumps a global `server_rev` and stamps the row.
  - Response: `{ cursor: newMaxRev, changes: Card[] }` — all of the user's cards with `server_rev > cursor` (including tombstones and the client's own accepted writes).
  - Client applies returned cards (LWW again), clears `dirty` on cards whose returned `updatedAt` matches local, saves new cursor.
- Sync triggers: app open, app regains focus/visibility, after any local change (debounced ~2 s), `online` event. Don't rely on Background Sync (not on iOS).
- Tombstones are kept forever for MVP (tiny); optional purge after 90 days later.
- Clock skew is acceptable for a single-user wallet; document it.

Other endpoints:
- `POST /api/auth/register` (only if `ALLOW_REGISTRATION=true` or no users exist yet — first user bootstrap)
- `POST /api/auth/login` → `{ token }`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/health` (for Uptime Kuma etc.)

Rate-limit login attempts (in-memory token bucket per IP is fine). Cap request bodies (e.g. 1 MB). Return JSON errors with stable codes.

**Origin note:** the PWA is served from the same origin as the API, so no CORS is needed. IndexedDB is bound to the origin; if the user changes the server's URL, local data won't follow. The export/import feature and server sync are the migration path, so document this in the README.

## 7. HTTPS and deployment

Camera access and service workers **require HTTPS** (localhost excepted). The container serves plain HTTP on one port; TLS is terminated in front of it. The README must document at least:

1. **Tailscale** (`tailscale serve` gives a `*.ts.net` HTTPS cert, no public exposure). Recommended default for home users.
2. **Reverse proxy** (Traefik/Caddy) with a real certificate.

Phone away from home and off the tailnet: the installed PWA still opens from cache and shows cards; it simply syncs next time the server is reachable. Make sure the service worker handles a failed API call gracefully and never blocks the UI.

### Container
- `Dockerfile`: stage 1 builds frontend (Node), stage 2 builds Go with the frontend `dist/` embedded (`CGO_ENABLED=0`), stage 3 `distroless/static:nonroot`.
- Runs as non-root. Single volume `/data` for `wallet.db`.
- Config via env vars:
  - `PORT` (default `8080`)
  - `DATA_DIR` (default `/data`)
  - `ALLOW_REGISTRATION` (default `false`; first user can always register)
  - `SESSION_TTL` (default `90d`, sliding)
  - `TRUST_PROXY_HEADERS` (default `false`, for client IP in rate limiting)
- Provide `docker-compose.yml` example with a Traefik-labels variant and a Tailscale-sidecar variant.
- Healthcheck: `/api/health` (distroless has no shell; implement a `healthcheck` subcommand in the binary for Docker `HEALTHCHECK`).
- Backup: document that copying `wallet.db` (or `sqlite3 .backup`) is the backup; optionally add `GET /api/export` for a user's JSON.

Budgets: image < 25 MB, idle RSS < 30 MB, cold start < 1 s.

## 8. PWA specifics (iOS is the hard part)

- Web app manifest: `display: "standalone"`, name, short_name, theme/background colour, maskable icons, and **`apple-touch-icon`** links (iOS ignores manifest icons for the home screen in some versions; include both).
- Add `<meta name="apple-mobile-web-app-capable">` / status-bar style meta tags.
- Service worker precaches the app shell, JS, CSS, fonts (self-hosted), icons and the zxing WASM. API calls are network-only (never cached by SW; data lives in IndexedDB).
- **Storage eviction:** Safari can evict script-writable storage for sites that aren't used; Home Screen web apps are treated better. Call `navigator.storage.persist()`, show an in-app prompt nudging the user to "Add to Home Screen" when running in a browser tab on iOS, and treat the server as the backup.
- **Camera in standalone mode:** iOS may re-prompt for camera permission more often than in Safari. Handle denied/unavailable cleanly and point users to the "scan from photo" or manual-entry fallback.
- Stop camera tracks when leaving the scan screen or when the page is hidden.
- Update flow: show a "new version available, reload" toast when the SW updates; never hot-swap mid-checkout.
- Safe-area insets (`env(safe-area-inset-*)`) for the notch/home indicator.
- Dark mode for the wallet UI, **but the card view barcode is always black on white.**

Verify current iOS Safari support for anything feature-detected (Wake Lock, `BarcodeDetector`, torch constraint) at implementation time rather than trusting this doc.

## 9. Security & privacy
- No third-party requests from the client at runtime. Strict CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:; ...`.
- Passwords: bcrypt (cost 12). Tokens: 32 random bytes, stored as SHA-256 hash.
- All card queries scoped by `user_id` from the session; test that one user can't read another's cards.
- Card values aren't highly sensitive but treat them as private. Never log card values.
- Security headers: HSTS (when behind TLS), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self)`.

## 10. Suggested repo layout
```
/web                  # Vite + Preact PWA
  /src
    /db               # Dexie schema, repo functions
    /scan             # camera + zxing-wasm wrapper, BarcodeDetector shim
    /render           # bwip-js wrapper, format mapping
    /sync             # sync client
    /routes           # wallet, add, card, edit, settings
  vite.config.ts
/server               # Go module
  /cmd/wallet         # main.go (serve, healthcheck, create-user subcommands)
  /internal/api
  /internal/store     # sqlite, migrations
  /internal/auth
  /migrations/*.sql
  embed.go            # embeds ../web/dist
Dockerfile
docker-compose.yml
docker-compose.tailscale.yml
README.md
```
Include a `create-user` CLI subcommand so an admin can add accounts without enabling registration.

## 11. Milestones

1. **Offline wallet, no server.** Vite PWA, Dexie, manual entry, render all formats, wallet list, card view, export/import JSON. Installable on iPhone, works in airplane mode.
2. **Scanning.** Live camera scan + scan-from-photo, format/value confirmation, round-trip tests.
3. **Server.** Go binary serving embedded PWA, auth, SQLite, sync endpoint, health, Dockerfile, compose files.
4. **Sync client.** Cursor-based sync, dirty tracking, triggers, status indicator, conflict tests.
5. **Polish.** Reorder, search, colours, wake lock, update toast, A2HS prompt, docs.

Each milestone should leave the app usable.

## 12. Acceptance criteria
- [ ] Installs to iPhone Home Screen from the self-hosted HTTPS URL and launches standalone.
- [ ] With the phone in airplane mode, the app opens and every saved card displays its barcode.
- [ ] Scanning works on iPhone Safari (installed PWA) for at least: Code 128, EAN-13, UPC-A, QR, PDF417.
- [ ] Scan-from-photo and manual entry work when camera permission is denied.
- [ ] Rendered barcodes decode back to the identical value and format (automated test for each supported format).
- [ ] A card added on device A appears on device B after sync; an edit on B wins over an older edit on A; a delete propagates.
- [ ] Changes made offline sync automatically when connectivity returns and the app is foregrounded.
- [ ] Export → wipe site data → import restores all cards.
- [ ] Container image < 25 MB, idle memory < 30 MB, runs on `linux/arm64`.
- [ ] No network requests to any host other than the app's own origin (verify in Playwright).
- [ ] Lighthouse PWA/installability checks pass.

## 13. Testing notes
- Unit: format mapping, LWW merge, sync cursor handling, Go store and handlers (table-driven, in-memory SQLite).
- E2E (Playwright): add/view/edit/delete, offline mode (`context.setOffline(true)`), two-context sync, import/export.
- Scanner: feed fixture images of each barcode format through the decode pipeline; don't depend on a live camera in CI.
- Manual test checklist for real devices: iPhone (Safari tab and installed), Android Chrome, real store scanner if possible (laser 1D scanners are pickier than camera scanners about quiet zones and bar width).

## 14. Open questions for the owner
- Multi-user households: separate accounts only (MVP), or shared cards later?
- App name and icon.
- Licence (if open-sourcing).
