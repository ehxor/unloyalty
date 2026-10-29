# Unloyalty — Implementation Plan

Companion to `HANDOFF.md`. Where this file disagrees with the handoff, this file wins (see §1).

## 1. Decisions & deviations from HANDOFF.md

| Topic | Decision |
|---|---|
| Name / licence | **Unloyalty**, MIT. Separate accounts only; no sharing. |
| Package manager | pnpm |
| Scanner | **zxing-wasm everywhere** (no native `BarcodeDetector` path). One decoder → consistent format names, fixture tests cover the shipped path. Use the `zxing-wasm/reader` subpath only. |
| Logout | **Wipe local cards + token on logout.** Before wiping: attempt a sync; if dirty cards remain, block with "N unsynced changes will be lost" + **Export** button + confirm. |
| `lastUsedAt` | Synced, merged with `max()`, **does not bump `updatedAt`** (otherwise viewing a card at checkout clobbers a newer rename from another device). |
| First user | As handoff: first registration always allowed. README must say "run `create-user` before exposing the server publicly". |
| Dexie booleans | IndexedDB can't index booleans. `deleted: 0\|1`; `dirty: number` (local change counter, 0 = clean; see §5). |
| Server PK | `cards` PK is `(user_id, id)`, not `id` — a guessed/colliding ID from another user can never touch your row. |
| Sync ack | Server returns the **winning row for every submitted ID**, not just `rev > cursor`. Fixes the stuck-dirty case where a rejected write's winner has `rev ≤ cursor`. |
| Restore safety | Server has a random `dbId` (created on first migration). Client stores it; on mismatch or `cursor > server cursor`, client resets cursor to 0 and marks all local cards dirty. |
| Timestamps | Canonical form `YYYY-MM-DDTHH:MM:SS.sssZ` (UTC, ms) on both sides so string compare == time compare. Local edits set `updatedAt = max(now, prev + 1ms)`. |
| LWW tie | Equal `updatedAt`: stored row wins on server (idempotent replays); client accepts server row when `server.updatedAt >= local.updatedAt`. |
| Embed | `//go:embed` can't use `..`. Build copies `web/dist` → `server/internal/webui/dist/` (gitignored, with a committed `.keep` stub so `go build` works without a frontend build). |
| Session touch | `last_seen_at` written at most once/hour per session. |
| HSTS | Sent only if `TRUST_PROXY_HEADERS=true` and `X-Forwarded-Proto: https`. |
| UUIDv7 | Hand-rolled (~15 lines, `crypto.getRandomValues`). |
| Lighthouse | Lighthouse removed its PWA category (v12). Replaced by a Playwright installability spec (§8) + manual DevTools manifest check. |
| Fonts | System font stack; nothing to self-host. |
| Binary payloads | `value` is a string. Decodes flagged as binary (non-text bytes) are rejected with a clear message for MVP. |
| Toolchain | `server/go.mod` pins `go 1.27` / `toolchain go1.27.3`; the local Go 1.22 fetches it automatically (`GOTOOLCHAIN=auto`). Dockerfile uses `golang:1.27-alpine`. |

## 2. Repo layout

```
/web
  package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json  playwright.config.ts
  index.html                       # apple-touch-icon, apple-mobile-web-app-* meta
  /public/icons                    # generated PNGs + source icon.svg
  /src
    main.tsx  app.tsx  styles.css  version.ts
    /lib       uuidv7.ts  time.ts  color.ts  platform.ts (isIOS, isStandalone)
    /db        schema.ts  cards.ts  meta.ts  exportImport.ts
    /formats   formats.ts (enum + mapping table)  validate.ts (check digits)  normalize.ts
    /render    render.ts (bwip-js → SVG)
    /scan      decoder.ts (zxing-wasm init, decode ImageData/Blob)  camera.ts (getUserMedia, torch, error classes)  useCameraScanner.ts (decode loop, lifecycle)
    /sync      client.ts (single-flight sync)  triggers.ts  status.ts  api.ts (fetch wrapper, auth)
    /sw        register.ts (prompt-mode update toast)
    /routes    Wallet.tsx  AddChooser.tsx  Scan.tsx  Manual.tsx  Confirm.tsx  CardView.tsx  Edit.tsx  Settings.tsx
    /components CardTile.tsx  Barcode.tsx  SyncBadge.tsx  Toast.tsx  ConfirmDialog.tsx  A2HSBanner.tsx  ColorPicker.tsx
  /test/unit  /test/e2e  /test/fixtures (barcode PNGs per format)
/server
  go.mod
  /cmd/wallet/main.go              # serve | healthcheck | create-user
  /internal/config                 # env parsing incl. "90d" durations
  /internal/store                  # sqlite open (WAL, busy_timeout), migrations runner, users/sessions/cards
  /internal/store/migrations/0001_init.sql
  /internal/auth                   # bcrypt, token gen/hash, ratelimit
  /internal/api                    # handlers, middleware (auth, body cap, security headers, errors)
  /internal/webui                  # embed.go + dist/ (copied at build)
Dockerfile  docker-compose.yml  docker-compose.tailscale.yml  Makefile  README.md  LICENSE  .gitignore
```

Migrations live under `internal/store` (not top-level) so `embed` can reach them.

## 3. Barcode format table (`web/src/formats/formats.ts`)

Single source of truth; every other module maps through it. 17 IDs (implemented in M1; `test/unit/roundtrip.test.ts` renders each with bwip-js, rasterises the SVG and decodes it with zxing-wasm 3).

| id | zxing-wasm reports | bwip-js encoder | Stored value / notes |
|---|---|---|---|
| code128 | Code128 (`]C0`) | code128 | printable ASCII |
| gs1_128 | Code128, contentType GS1 | gs1_128 | HRI form `(01)…(10)…` (decoder re-reads GS1 symbols with `textMode: 'HRI'`) |
| code39 | Code39 / Code39Std | code39 | `0-9A-Z -.$/+%`; a check char, if printed, is kept as data → identical bars |
| code39ext | Code39Ext | code39ext | full ASCII (zxing auto-detects `+A` → `a`; re-rendering gives identical bars) |
| code93 | Code93 | code93ext + `includecheck` | Code 93 check chars are mandatory; bwip omits them by default |
| ean13 | EAN13 (no leading 0) | ean13 | 13 digits; 12 → compute check |
| ean8 | EAN8 | ean8 | 8 digits; 7 → compute check |
| upca | UPCA **or** EAN13 with leading 0, always 13 digits | upca | 12 digits; leading-zero EAN-13 canonicalised to UPC-A (identical bars) |
| upce | UPCE, expanded to 13 digits | upce | compressed back to 8 digits (NS + 6 + check) |
| itf | ITF / ITF14 | interleaved2of5 | even digit count; check digit kept as data |
| codabar | Codabar | rationalizedCodabar | stored **with** A–D start/stop; manual entry adds `A…A` if missing |
| qr / gs1_qr | QRCode (`]Q1` / GS1) | qrcode / gs1qrcode | UTF-8 text |
| pdf417 | PDF417 | pdf417 | UTF-8 text |
| aztec | Aztec | azteccode | UTF-8 text |
| datamatrix / gs1_datamatrix | DataMatrix (`]d1` / GS1) | datamatrix / gs1datamatrix | UTF-8 text |

Gotchas found while pinning this: bwip-js PNG/SVG must have an opaque white background (transparent → zxing finds nothing); never pass `height` to 2D encoders (it distorts the symbol); binary payloads (contentType Binary) are rejected.

## 4. Data model

### Client (Dexie, db name `unloyalty`, version 1)
```ts
cards: 'id, dirty, deleted, sortOrder, lastUsedAt'
meta:  'key'   // syncCursor, dbId, token, user, prefs (sort mode), persistResult
interface Card {
  id: string; name: string; format: FormatId; value: string;
  color?: string; notes?: string; sortOrder: number;
  createdAt: string; updatedAt: string; lastUsedAt?: string;
  deleted: 0 | 1;
  dirty: number;   // 0 = clean; incremented on every local change
}
```
Wire format (`SyncCard`) = Card minus `dirty`, `deleted` as boolean.

### Server (`0001_init.sql`)
```sql
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- db_id, rev
CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE sessions(token_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, user_agent TEXT);
CREATE TABLE cards(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
  name TEXT NOT NULL, format TEXT NOT NULL, value TEXT NOT NULL, color TEXT, notes TEXT,
  sort_order REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT,
  deleted INTEGER NOT NULL DEFAULT 0, server_rev INTEGER NOT NULL,
  PRIMARY KEY(user_id, id));
CREATE INDEX cards_user_rev ON cards(user_id, server_rev);
```
Pragmas on open: `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`. Single writer connection (`SetMaxOpenConns(1)`) — trivially correct and plenty for this load. Migrations: `schema_migrations(version)` table, apply embedded `NNNN_*.sql` in order, each in a tx.

## 5. Sync protocol (final)

`POST /api/sync` — `{ dbId?: string, cursor: number, changes: SyncCard[] }` → `{ dbId, cursor, changes: SyncCard[] }`

Server, inside `BEGIN IMMEDIATE`:
1. If request `dbId` present and ≠ server's, or `cursor > rev`, respond `409 {code:"cursor_reset"}`.
2. For each incoming card (validated; ≤ 500 per request):
   - no stored row, or `incoming.updatedAt > stored.updatedAt` → `rev++`, upsert all fields, `last_used_at = max(stored, incoming)`.
   - else if `incoming.lastUsedAt > stored.lastUsedAt` → `rev++`, update `last_used_at`, `server_rev` only.
   - else no write.
3. Return rows where `user_id = ? AND (server_rev > cursor OR id IN submitted)`, and `cursor = rev`.

Client (`sync/client.ts`), single-flight:
1. Send dirty cards, ≤ 500 per round; another round while a full batch went out (cap 50 rounds). Calls during a running sync make it go round once more.
2. On `409 cursor_reset`: drop cursor and `dbId`, `dirty++` on all cards, retry once from cursor 0.
3. For each returned card (validated with `parseWireCard`): `lastUsedAt = max(local, server)`. If local missing or `server.updatedAt >= local.updatedAt` → take server fields, `dirty = 0` unless the local `lastUsedAt` is later than the server's. Otherwise (edited while the request was in flight) keep local, still dirty. No per-request snapshot is needed: `nextUpdatedAt` makes any later local edit strictly newer than what was sent.
4. Card writes, cursor, `dbId` and `lastSyncAt` commit in one Dexie transaction, which first checks the token is still the one used for the request (a sign-out mid-flight discards the response).
5. `401` → drop the token, keep `user` and all cards, status `signed-out` + `sessionExpired` (sign in again, nothing lost). Network failure → `offline`. Other errors → `error` with the server's message.

Triggers (`triggers.ts`): app start, `visibilitychange`→visible, `focus`, `online` (coalesced, 250 ms), user changes via `db/events.ts` (2 s debounce). Sync writes don't emit change events. Failures never throw into the UI. The status store (`starting | signed-out | idle | syncing | offline | error`) plus a live pending count drive the wallet chip (Synced / *N* waiting / Offline / Sync error / Local only).

Sessions (`session.ts`): sign-in/registration merge existing local cards into the account. Signing in as a different account than the one whose cards are on the device asks first, then wipes. Sign-out syncs first; if changes remain unsynced it shows the count with Export / Sign out anyway / Cancel, then calls `/api/auth/logout` (best effort) and wipes cards + sync meta.

Clock skew: documented in README as accepted for single-user wallets.

## 6. API

Errors: `{ "error": { "code": "<stable>", "message": "<human>" } }`. Codes: `bad_request, unauthorized, forbidden, not_found, conflict, username_taken, registration_closed, rate_limited, payload_too_large, cursor_reset, internal`.

| Method/path | Auth | Notes |
|---|---|---|
| `GET /api/health` | – | `{status:"ok", version}`; pings DB |
| `POST /api/auth/register` | – | allowed if `ALLOW_REGISTRATION` or zero users; username 3–64 `[a-z0-9._-]`, password 8–72 bytes (bcrypt limit); returns `{token, user}`; rate-limited |
| `POST /api/auth/login` | – | `{token, user}`; rate-limited; constant-ish time on unknown user (compare against dummy hash) |
| `POST /api/auth/logout` | ✓ | deletes session |
| `GET /api/me` | ✓ | `{user:{id, username}, registrationOpen}` |
| `POST /api/sync` | ✓ | §5 |
| `GET /api/export` | ✓ | user's non-deleted cards in the export JSON format (§7.5) |
| `GET /api/config` | – | `{registrationOpen, version}` so Settings can show/hide "Create account" pre-login |

Middleware order: recover → security headers → body cap (1 MB, `http.MaxBytesReader`) → auth (per-route). No request logging of bodies; log method, path, status, duration only.

Rate limit: token bucket per IP (burst 5, refill 1/12 s) for login+register; map pruned every 10 min. Client IP = `RemoteAddr`, or first `X-Forwarded-For` hop when `TRUST_PROXY_HEADERS=true`.

Static: embedded FS. `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`; `index.html`, `sw.js`, `manifest.webmanifest`, `registerSW.js` → `no-cache`. Unknown non-`/api` GET → `index.html` (SPA). Unknown `/api/*` → JSON 404.

Headers on all responses:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
  img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(self), screen-wake-lock=(self)
```

CLI (`cmd/wallet`): `wallet serve` (default), `wallet healthcheck` (GET `http://127.0.0.1:$PORT/api/health`, exit 0/1, 3 s timeout), `wallet create-user <username>` (password from `WALLET_PASSWORD` env or prompted on TTY; works while server is running thanks to WAL + busy_timeout).

Config: `PORT=8080`, `DATA_DIR=/data`, `ALLOW_REGISTRATION=false`, `SESSION_TTL=90d` (parser accepts `d` suffix + Go durations), `TRUST_PROXY_HEADERS=false`. Graceful shutdown on SIGTERM.

## 7. Frontend details

### 7.1 Routes (preact-iso)
`/` Wallet · `/add` chooser (Scan / From photo / Manual) · `/add/scan` · `/add/manual` · `/add/confirm` (pending scan result held in a module-level store, not the URL — values are private) · `/card/:id` · `/card/:id/edit` · `/settings`. Re-scan from Edit: `/add/scan?replace=:id` → Confirm shows old vs new, updates existing card.

### 7.2 Scanning
- `decoder.ts`: `prepareZXingModule({ overrides: { locateFile } })` pointing at `zxing_reader.wasm?url` (bundled, precached). Initialised on first use; formats restricted to `DECODER_FORMATS`; `tryHarder`, `tryRotate`, `tryInvert` on; GS1 symbols re-read in HRI mode.
- `camera.ts`: `getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })`; errors classified (`denied` / `not-found` / `in-use` / `unsupported` / `failed`) with user-facing messages.
- `useCameraScanner.ts`: decode loop via `requestVideoFrameCallback` where present else `setTimeout(…, 100)`; frame drawn to a canvas downscaled to ≤ 1280 px long side → `ImageData`; one decode in flight, ≥ 100 ms apart. A read is accepted when the same (format, value) is seen twice within 1.5 s. On success: `navigator.vibrate?.(50)` (no-op on iOS) + green frame, hand-over after 250 ms. Unusable symbols (unsupported format, binary) show their reason as the status line.
- Torch: toggle shown only if `track.getCapabilities?.().torch`; a failed `applyConstraints` hides it.
- Lifecycle: tracks stopped on unmount and on `visibilitychange` → hidden; reacquired when visible. A generation counter discards a `getUserMedia` that resolves after teardown.
- Errors: inline panel; "Scan from photo" and "Type it in" are always on the scan screen, so denial never dead-ends.
- Re-scan: Edit → `/card/:id/rescan` (same screen) → back to Edit with the new barcode pre-filled and a "Save changes to keep it" notice; leaving without saving keeps the old barcode.
- From photo: `<input type="file" accept="image/*">` → `readBarcodes(file)` (zxing decodes the encoded image directly). Multiple results → let user pick.

### 7.3 Rendering
`render.ts`: bwip-js `toSVG` with per-format options: `includetext` for 1D, `scale`/`height` tuned, quiet zones via `paddingwidth/paddingheight` (10× module for 1D, 4 modules for 2D), black on white. `Barcode.tsx` injects the SVG as an `<img src="data:image/svg+xml;...">` (CSP-safe, crisp at any DPR, sized `width:100%` / `max-height`). Import only the needed encoders if bwip-js exposes per-symbology entry points; otherwise accept the full browser build (measure, budget ≤ 1 MB, it's precached).

### 7.4 Card view
White full-screen surface regardless of theme; name at top, close button; barcode max width minus quiet zone; rotate toggle for 1D (CSS rotate 90° to use the long axis). Wake Lock requested on mount and re-requested on `visibilitychange`; released on unmount; failures ignored. Sets `lastUsedAt` (dirty++, `updatedAt` unchanged).

### 7.5 Export / import
Export: `{ app: "unloyalty", version: 1, exportedAt, cards: SyncCard[] }` (non-deleted). Download via Blob + `<a download>`; if `navigator.canShare({files})` (iOS standalone), offer Share instead. Import: validate schema + each card via `formats/validate.ts`; merge by `id` with LWW on `updatedAt`; imported winners `dirty++`; report "N added, M updated, K skipped".

### 7.6 Wallet
Grid of tiles (colour = user pick or HSL hash of name). Search box filters by name (case/diacritic-insensitive). Sort toggle: Manual / Recently used. Reorder mode: drag handles with pointer events (no library); moved card gets `sortOrder` = midpoint of neighbours (renormalise when gap < 1e-9). New cards: `max + 1`. Empty state CTA. `SyncBadge` in header.

### 7.7 Settings
Account (status, login / create account / logout-with-wipe flow), sync status + "Sync now", Export / Import, persistent-storage result (requested on first save, `navigator.storage.persisted()` shown), brightness hint, version + "Check for update" (`registration.update()`).

### 7.8 PWA
`vite-plugin-pwa`, `generateSW`, `registerType: 'prompt'`, `injectRegister: 'script'` (no inline script → CSP). `globPatterns: ['**/*.{js,css,html,svg,png,wasm,webmanifest}']`, `maximumFileSizeToCacheInBytes: 5 MB`, `navigateFallback: '/index.html'`, `navigateFallbackDenylist: [/^\/api\//]`, no `runtimeCaching` (API is network-only by default). Update toast: "New version — Reload"; suppressed while on `/card/:id`, shown on next navigation. Manifest: `display: standalone`, `start_url: '/'`, `scope: '/'`, name/short_name "Unloyalty", theme + background colours, icons 192/512 + maskable 512. `index.html`: `apple-touch-icon` 180, `apple-mobile-web-app-capable`, `mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `viewport-fit=cover`. Icons generated from `public/icons/icon.svg` with `@vite-pwa/assets-generator` (dev dep, build-time only). A2HS banner: iOS + not standalone → dismissible "Share → Add to Home Screen" hint (dismissal stored in meta).

CSS: custom properties, `prefers-color-scheme` dark theme, `env(safe-area-inset-*)` padding on header/footer.

## 8. Testing

**Vitest (web)** — `fake-indexeddb` for Dexie.
- `formats`: check-digit compute/validate for EAN-13/8, UPC-A/E; ITF parity; Codabar start/stop normalisation; Code 39 charset.
- **Round-trip, all 13 formats**: bwip-js (node `toBuffer` PNG) → zxing-wasm `readBarcodes` → identical `value` and `format`. Include leading-zero EAN/UPC, Codabar, GS1 Code 128, long Code 128, unicode QR.
- **Fixture decode**: `test/fixtures/*.png` (generated once by script + a few real photos if available) through `decoder.ts`.
- `sync/client`: fake fetch; LWW cases (local newer kept dirty, server newer wins, equal → server, mid-flight edit stays dirty, lastUsedAt max, cursor_reset path, 401 path, batching >500).
- `exportImport`: round-trip, merge precedence, invalid file rejection.
- `uuidv7`: version/variant bits, monotonic ordering.

**Go** — `go test ./...`, table-driven, temp-file SQLite per test.
- store: migrations idempotent; upsert LWW incl. tie; lastUsed-only path bumps rev; rev monotonic; dbId stable.
- api (httptest): register bootstrap rules (first user, closed, open); login ok/bad/rate-limited; logout invalidates; **user B cannot read or overwrite user A's card with the same id**; sync returns winners for submitted ids; cursor_reset on dbId mismatch/cursor ahead; 1 MB cap → 413 JSON; security headers present; SPA fallback vs `/api` 404; session TTL expiry + sliding touch.
- config: duration parsing.

**Playwright** — runs against the real Go binary (`make server`, fresh `DATA_DIR` per run) on port 4174, so the deployed CSP, cache headers and SPA fallback are under test. Full Chromium (`channel: 'chromium'`; headless-shell has no video capture) with a **fake camera** playing a generated Motion-JPEG of a Code 128 barcode (`global-setup.ts`). Playwright WebKit skipped (doesn't install cleanly on Arch, isn't iOS Safari anyway). Two auto fixtures on every test: **no request left the app's origin**, and **no CSP violation** was logged.
- `crud.spec`: manual add (each format family) → view → edit → delete.
- `offline.spec`: load, wait for SW control, add cards, `context.setOffline(true)`, reload, every card renders.
- `sync.spec`: two devices, same account: add on A appears on B; A's offline (older) edit loses to B's newer edit after A reconnects; delete on B propagates; a card added offline syncs on reconnect; cards made before sign-in join the account; sign-out warns about 1 unsynced change, wipes, and the synced card comes back on re-sign-in; create account from the app; wrong password message. The e2e server runs with `ALLOW_REGISTRATION=true` and `TRUST_PROXY_HEADERS=true`; each simulated device sends its own `X-Forwarded-For`, so the login rate limit is per device.
- `importExport.spec`: export download → clear storage (`context.clearCookies` + new context / `indexedDB.deleteDatabase`) → import → all cards back.
- `scanPhoto.spec`: upload generated PNG → Confirm shows correct format/value; photo without a barcode → explanation.
- `scanCamera.spec`: live scan → Confirm → saved; camera released on page-hidden and on leaving (blank canvas camera records tracks); re-scan replaces only after Save; camera denied → message, photo + manual still work.
- ~~`thirdParty.spec`~~: done as the auto fixture in `test/e2e/fixtures.ts`.
- `installability.spec`: manifest fetched and has required fields/icons; `navigator.serviceWorker.controller` set after reload; offline reload works.

**Budgets** — `scripts/check-budgets.sh` (`make budgets`): image size, cold start (`docker start` → health 200), `docker stats` memory after 30 s idle. Measured on amd64: **15.1 MB, 138 ms, 5.6 MiB**. arm64 image builds without emulation (Go cross-compiles; final stage has no `RUN`) and contains an aarch64 binary; running it here needs QEMU binfmt, not installed on this machine.

**Manual device checklist** (README): iPhone Safari tab + installed (install, camera scan of Code 128/EAN-13/UPC-A/QR/PDF417, photo scan, camera-denied fallback, airplane mode, wake lock, update toast, safe areas), Android Chrome, a real store scanner.

## 9. Container & deploy

Dockerfile (all build stages on `$BUILDPLATFORM`, Go cross-compiles → no QEMU for builds):
1. `node:<lts>-alpine` + corepack pnpm → `pnpm install --frozen-lockfile && pnpm build`.
2. `golang:<current>-alpine` → copy `web/dist` to `internal/webui/dist`; `CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w -X main.version=$VERSION"`; `mkdir /out/data`.
3. `gcr.io/distroless/static-debian12:nonroot` → `COPY --chown=65532:65532 /out/data /data`, binary at `/wallet`, `VOLUME /data`, `EXPOSE 8080`, `HEALTHCHECK CMD ["/wallet","healthcheck"]`, `ENTRYPOINT ["/wallet"]`.

`docker buildx build --platform linux/amd64,linux/arm64`. Makefile targets: `web`, `server`, `dev`, `test`, `e2e`, `image`, `budgets`.

Compose:
- `docker-compose.yml`: app + named volume; Traefik variant via labels (router, TLS certresolver, `TRUST_PROXY_HEADERS=true`).
- `docker-compose.tailscale.yml`: `tailscale/tailscale` sidecar (`TS_AUTHKEY`, `TS_SERVE_CONFIG` JSON proxying 443 → `127.0.0.1:8080`, state volume), app with `network_mode: service:tailscale`.

README: what it is; quick start (Tailscale recommended, Traefik/Caddy alternative); create first user via `create-user` **before** exposing publicly; env vars; HTTPS requirement; backup (`wallet.db` copy / `sqlite3 .backup`, `GET /api/export`); origin change = export/import or sync; logout wipes device data; clock-skew note; bind-mount ownership (uid 65532); known limits (iOS torch, laser scanners vs screens, brightness).

## 10. Milestones (each leaves the app usable)

**M0 — Scaffold.** ✅ `git init`, `.gitignore`, LICENSE (MIT), pnpm Vite+Preact+TS strict, Vitest, Playwright config, Makefile. (Go module deferred to M3 rather than committing an empty skeleton.)

**M1 — Offline wallet, no server.** ✅ formats/validate/fromDecoder + render + round-trip tests (all 17 format IDs). Dexie schema, uuidv7, Wallet (with search + colours) / Add chooser / Manual / Confirm / CardView (wake lock, rotate, markUsed) / Edit+delete / Settings (export/import, persistence, version, update check). **Scan from photo** pulled forward from M2 (decoder was needed for tests anyway). PWA manifest, icons, generateSW precache incl. zxing WASM, prompt-mode update toast (suppressed on the checkout screen).
  *Verified:* 70 unit tests; 8 Playwright specs (CRUD, invalid input, search, offline incl. deep link, export → fresh profile → import, re-import idempotent, photo scan, no-barcode photo); manual visual pass in light + dark.
  *Device check:* installed and working on the owner's iPhone via `tailscale serve` (2026-10-29).

**M2 — Scanning.** ✅ camera.ts, useCameraScanner, live Scan route (`/add/scan`), camera-denied fallbacks, re-scan from Edit (`/card/:id/rescan`). Photo scan extracted to a shared `PhotoScan` component.
  *Verified:* 12 Playwright specs incl. 4 camera specs (stable over 4× repeat); 70 unit tests.
  *Device check:* owner confirmed working on iPhone. Still worth watching: decode speed per frame on older phones (knobs: `MAX_FRAME_SIDE`, dropping `tryInvert` for live frames).

**M3 — Server.** ✅ config (env, `90d` durations), store (WAL, single connection, embedded numbered migrations, `db_id` + global `rev` in `meta`), users/sessions (sliding TTL, hourly touch, periodic purge), sync per §5, auth (bcrypt 12 with lazy dummy hash for unknown users, SHA-256 token hashes, per-IP token bucket 5 / 12 s), handlers, embedded static serving (immutable `/assets`, `no-cache` elsewhere, SPA fallback, 404 for missing files), security headers + CSP, request logging without bodies (healthy health checks skipped), CLI `serve` / `healthcheck` / `create-user` / `version`, Dockerfile, both compose files, budgets script.
  *Verified:* Go tests for store (LWW incl. stale-cursor winner echo, ties, lastUsed max, tombstones, user isolation, cursor ahead, first-user race guard, sliding sessions), API (bootstrap + open registration, login/logout/me, rate limit 429 + Retry-After, sync auth/validation/413/unknown fields/cursor_reset, cross-user isolation, static + headers, HSTS gating), config. 12 Playwright specs green against the binary with the CSP fixture (fixture proven to fail on an injected inline script). Container smoke: `create-user` while running, registration closed afterwards, login, sync, export, data survives restart, Docker health `healthy`, logs free of card data.
  *Not verified:* Tailscale sidecar compose (needs an auth key). (arm64 running: since verified in CI under QEMU, see §11.)

**M4 — Sync client.** ✅ `sync/api.ts` (typed errors: `ApiError` / `NetworkError`), `sync/client.ts` (engine + status store), `sync/triggers.ts`, `sync/session.ts`, `db/events.ts`, `SyncBadge`, Settings `AccountPanel`.
  *Verified:* 11 sync-engine unit tests (push/clear, pull incl. tombstones, lost edit takes server copy, mid-flight edit stays dirty, lastUsed max incl. mid-flight checkout, cursor reset re-sends all, 401 keeps cards, offline keeps changes, batching 520 → 500 + 20, sign-out mid-flight discards response, single-flight); 5 Playwright sync specs, stable over 4× repeat; full e2e suite (17) green against the Go binary.

**M5 — Polish.** ✅ Wallet sort toggle ("My order" / "Recently used", per-device `sortMode` meta), reorder mode (pointer-drag handle with `touch-action: none` + accessible ▲/▼ buttons; `moveCard` midpoint ordering, one card dirty per move, renumbering when the gap < 1e-9), iOS-in-Safari "Add to Home Screen" hint (dismissible, `a2hsDismissed` meta), installability spec, README device checklist.
  *Fixed along the way:* the sync chip and account panel briefly showed "Synced" before the pending count loaded; they now render nothing until it has (caught by the two-device spec).
  *Verified:* 88 unit tests; 23 Playwright specs green against the Go binary (new: drag + arrow reorder persisting, recently-used order persisting, install hint on iOS UA only + dismissal, Chrome installability via CDP, manifest/icon sizes/apple-touch-icon). New specs stable over 3× repeat.

## 11. Acceptance criteria (HANDOFF §12)

| Criterion | Status | Evidence |
|---|---|---|
| Installs to iPhone Home Screen from the self-hosted HTTPS URL, launches standalone | ✅ device | Owner installed via `tailscale serve` (M1). Automated: `installability.spec` (Chrome reports no installability errors; manifest, icons, `apple-touch-icon`, iOS meta tags) |
| Airplane mode: app opens, every saved card displays | ✅ auto + device | `offline.spec` (SW-controlled reload and deep link with network off); owner check after M1 |
| Scanning works in the installed iPhone PWA for Code 128, EAN-13, UPC-A, QR, PDF417 | ◑ device, per-format pending | Owner reported live scanning works (M2). Formats individually: device checklist below. Automated: fake-camera live scan (`scanCamera.spec`), decoder round-trip for all formats |
| Scan-from-photo and manual entry work when camera permission is denied | ✅ auto | `scanCamera.spec` "camera denied" |
| Rendered barcodes decode back to identical value and format, every format | ✅ auto | `roundtrip.test.ts`: 32 cases over all 17 format IDs, plus EAN-13/UPC-A equivalence |
| Added on A appears on B; B's newer edit wins over A's older; delete propagates | ✅ auto | `sync.spec` two-device test |
| Offline changes sync automatically when connectivity returns and the app is foregrounded | ✅ auto | `sync.spec` (reconnect via `online` event); foreground triggers wired in `triggers.ts` |
| Export → wipe site data → import restores all cards | ✅ auto | `importExport.spec` (fresh browser profile) |
| Image < 25 MB, idle memory < 30 MB, runs on linux/arm64 | ✅ CI | Checked on every CI run (`.github/workflows/ci.yml`): 15.2 MB, 181 ms cold start, 4.6 MiB idle on amd64; the arm64 image boots under QEMU and answers `/api/health`. Published multi-arch as `ghcr.io/ehxor/unloyalty`. A real Pi is still on the device checklist. |
| No requests to any host but the app's origin | ✅ auto | Auto fixture on every Playwright test (plus a CSP-violation fixture) |
| ~~Lighthouse PWA~~ → installability | ✅ auto | Lighthouse removed the PWA audit; `installability.spec` uses Chrome's own `Page.getInstallabilityErrors` |

Remaining owner checks are listed in README → "Device checklist".

## 12. Open risks
- ~~zxing-wasm format strings / UPC-A vs EAN-13~~: resolved in M1, see §3.
- ~~bwip-js bundle size~~: named encoder imports work; main chunk 548 KB (170 KB gzip), zxing WASM 947 KB; total precache 1.5 MB.
- iOS standalone camera re-prompting: mitigated by photo/manual fallback; owner reported scanning works in the installed app.
- Wake Lock in iOS Home Screen apps was broken before iOS 18.4 [INFERENCE: verify on device]; feature-detected, failure ignored. On the device checklist.
- Playwright WebKit ≠ iOS Safari; the device checklist is the source of truth for iOS behaviour.
- Reorder is a whole-card last-write-wins edit: reordering on a device that hasn't yet pulled another device's rename of the same card can undo that rename. Same accepted trade-off as other concurrent edits (see Clock skew); "last used" is the one field merged separately.
