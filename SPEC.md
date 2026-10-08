# Steam Deals — Build Spec

A standalone Windows desktop app. Anyone can install it, sign in with their Steam account,
and browse the best current Steam discounts on games they do not already own. Modern, dark,
polished UI with store art. No API key or technical setup required from the user.

## 1. Goals and non-goals

Goals
- Installer: a single `Steam Deals Setup x.y.z.exe` (NSIS, per-user, desktop + Start Menu shortcut).
- Sign in through Steam using Steam's own login page. The app never sees the password.
- Hide everything the user owns (including free-to-play) and surface a ranked list of deals.
- Filters: min discount, min rating, min review count, tags, wishlist-only, hide-owned, region.
- Ranking: composite score (discount 40 / rating 35 / popularity 25), weights adjustable.
- Fast: a 3,000-game scan completes in under ~10 s on a normal connection, with progress shown.
- Looks and feels like a 2026 app: dark glass surfaces, store header art, smooth motion, good type.

Non-goals
- No price history (Steam has no API for it). No purchasing. No third-party services (no SteamDB, no IsThereAnyDeal).
- No backend server. Everything runs on the user's machine.
- No macOS/Linux installers in this pass (code stays cross-platform; only a Windows build is produced here).

## 2. Stack

- Electron 44 (Chromium + Node). electron-builder 26 for the NSIS installer.
- Renderer: vanilla HTML/CSS/JS modules, no bundler, no framework. Keeps the build trivial and the app small.
- Node 24 for scripts; Python + Pillow only for generating the icon at build time (checked in, so not needed by users).

## 3. Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the folder map (restructured in v1.8.0: the interface is ES modules
split into lib / logic / ui / views with an event hub; the main process is split into window, tray, deep links,
per-feature IPC handlers, session renewal, library/taste, and the sync engine; the stylesheet is 16 files in
cascade order; unit tests in test/ run before every build and deploy).

Rules
- All network traffic happens in the main process. The renderer's CSP has `connect-src 'none'`.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Preload exposes only named functions.
- External links open in the system browser via `shell.openExternal`, allowlisted to `store.steampowered.com`,
  `steamcommunity.com`, and `steam://` (opens the Steam client).

## 4. Authentication

Primary: Sign in through Steam
1. Open a child BrowserWindow (partition `persist:steam`, 520x820) at `https://store.steampowered.com/login/`.
2. The user signs in on Steam's page (including Steam Guard). We do not inject anything into that page.
3. On each navigation and on a 1 s poll, read the `steamLoginSecure` cookie for `store.steampowered.com`.
   Its value is `<steamid64>%7C%7C<token>`. When present, extract the SteamID64, close the window, resolve.
4. Closing the window before login resolves as cancelled, not an error.
5. With that session's cookies, fetch `https://store.steampowered.com/dynamicstore/userdata/?id=<steamid>&_=<ts>`
   with `Cache-Control: no-cache` → `rgOwnedApps` (all owned appids incl. F2P) and `rgWishlist`.
   Empty `rgOwnedApps` while signed in means the session expired → prompt to sign in again.
6. Display name and avatar come from the public profile XML `https://steamcommunity.com/profiles/<id>/?xml=1`.
7. Persist `{ steamid, name, avatar, signedInAt }` in settings. Cookies persist in the partition across restarts.

Sign out: clear the `persist:steam` partition storage and drop the account from settings.

Fallbacks
- Browse as guest: deals only, no ownership filtering. Shown as a clear secondary action.
- Advanced: paste a Steam Web API key + SteamID64 (or vanity name). Uses `IPlayerService/GetOwnedGames`
  with `include_played_free_games=1&include_free_sub=1`. Stored locally, never displayed after entry.

### 4.1 Staying signed in (v1.6.1, corrected in v1.8.0)

Electron does not keep session cookies (no expiry) across restarts, even in a `persist:` partition (verified
with a dummy cookie), and Steam's store login cookie is a session cookie. Until 1.6.0 that meant a fresh sign-in
on every launch, and a dead session after Steam's short-lived login expired, because the app never loaded a store
page where Steam's own script renews the login from the persistent "Remember me" cookie. `auth.keepAlive()` now
loads `https://store.steampowered.com/` in a hidden sandboxed window on the Steam partition, waits ~3.5 s after
load for the page's own renewal, then only re-reads the SteamID from the cookie; it runs when `auth:status`
finds the SteamID missing (launch), every 6 hours, and once more before `cartSession` gives up with
`session_expired`. The app never touches the page or any token. Verified: after a restart the app came back
signed in with the cart working, with no prompt.

Correction (v1.8.0): the steamLoginSecure cookie is in fact persistent (it survives restarts); what expires is
the short-lived token inside it. Keep-alive only ran when the cookie was missing, so after a day the library and
cart reported "session expired" with a perfectly good Remember-me login. `steam-session.js` now wraps every
store-session call (`userData`, `webApiToken`, `cartSession`): if Steam answers "not signed in", renew through
the store page once and retry. Verified: library signed out before renewal, 2,902 games read after.

### 4.2 Steam Deck / Steam Machine ratings (v1.7.0–1.7.2)

Plain words: a single sidebar switch, "Steam Deck / Machine only", shows only games Valve rates Verified or
Playable on the Steam Deck or the Steam Machine; cards badge the rating (✓ Verified, ~ Playable).

`include_platforms: true` in the store query brings `platforms.steam_deck_compat_category` and
`steam_machine_compat_category` (0 unknown, 1 unsupported, 2 playable, 3 verified; Steam OS and Steam Frame
categories also exist and are ignored). `normalizeItem` keeps them as `deck` and `machine`. A single
switch `deckMachineOnly` (sidebar group "Plays on", part of Reset) keeps games with `deck >= 2 || machine >= 2`
(Verified or Playable on either device); off shows everything. The user asked for exactly one toggle with these
semantics (1.7.0 had two per-device dropdowns, 1.7.1 a Verified-only switch). 1.7.2 also fixed the desktop
scan, which built its own query without `include_platforms` and therefore saw every game as unrated; its cache
key moved to `catalog:v4`. Cards badge Verified (✓) and Playable (~). Cards show a compact "Deck ✓ / Machine ✓" badge for Verified; the details panel shows every published
rating. Deal caches were bumped (`catalog:v3`, `/api/deals…&v=2`) so old scans without the ratings refresh.

## 5. Data

Deals: `IStoreQueryService/Query/v1` (keyless)
- `query: { start, count: 500, sort: 10 (popularity), filters: { price_filters: { min_discount_percent }, type_filters: { include_apps, include_games }, released_only: true } }`
- `context: { language, country_code, steam_realm: 1 }`
- `data_request: { include_basic_info, include_reviews, include_release, include_tag_count: 8 }`
- Page until `scanDepth` items (1,000 / 3,000 / 6,000; default 3,000) or `total_matching_records`.
- Spacing 250 ms between pages; on 429/5xx back off (1.5 s, 3 s, 6 s) up to 3 retries.
- Report progress `{ fetched, target }` to the renderer after each page. Cancellable.
- Client-side filter: `item_type === 0`, `type === 0` (game), `visible`, has `best_purchase_option`, not `is_free`,
  `discount_pct >= minDiscount` (server filter is advisory), review `percent_positive >= minRating`, `review_count >= minReviews`.
- Keep per item: appid, name, discount, final/original formatted price, final price cents, percent_positive, review_count,
  review label, release date, tagids, short description, header image URL.

Tags: `IStoreService/GetTagList/v1?language=` → `{tagid: name}`; cached 7 days.

Caching: deals pages cached keyed by `(country, language, scan floor, scanDepth)`. "Refresh" bypasses the cache.
The scan asks Steam for one of a few fixed discount floors (50, 25, 10, 1) covering the UI's minimum, so the cache is
shared across most filter changes; the UI narrows client-side. Lowering the minimum below the current floor rescans.

Wishlist: signed in, wishlist games the scan didn't include are looked up by appid (`GetItems`) after each scan, so
"Wishlist only" shows every wishlist game on sale; the discount, rating and review minimums don't apply to it.

Images: the header art path Steam lists for the game (`include_assets`: `assets.asset_url_format` + `assets.header`,
under `https://shared.akamai.steamstatic.com/store_item_assets/`), since newer games have no plain
`steam/apps/<appid>/header.jpg`; that plain address is the fallback. 460x215, lazy-loaded.

## 6. Scoring

For the currently filtered set S (after owned/wishlist/tag/rating/review filters):
```
popularity_i = 100 * log10(reviews_i) / log10(max_j reviews_j)      (0 when max is 1)
score_i      = w_d * discount_i + w_r * rating_i + w_p * popularity_i    with w_d + w_r + w_p = 1
```
Defaults 0.40 / 0.35 / 0.25. Sliders in Settings re-normalize to 1. Sort options: Score, Discount, Rating, Reviews, Price (low→high), Name.

## 7. UX

Screens
1. Sign in: full-bleed dark gradient with soft animated color blobs. Centered glass card: logo mark, "Steam Deals",
   one-line pitch, primary button "Sign in through Steam" (Steam-green gradient), secondary "Browse as guest",
   small "Use an API key instead" expander. Footer: privacy sentence.
2. Browse:
   - Title bar (hidden native frame + overlay caption buttons): app mark + name on the left; drag region.
   - Top bar: search (`/` focuses), sort select, Refresh with "updated 4 min ago", account chip (avatar, name) → menu (Settings, Sign out).
   - Left sidebar (280 px): Min discount slider (Any–95), Min rating slider (50–95), Min reviews select, toggles (Hide owned, Wishlist only),
     Tags (chips, top 30 by frequency in the current pool, multi-select, searchable), Scan depth, Reset filters.
   - Stats strip: "412 deals · 638 owned hidden · best discount 95%".
   - Grid of cards (auto-fill, min 300 px): header art, discount badge (top-left, green), score ring (top-right), title,
     price row (final bold, original struck), rating row (percent + label + count), 3 tag chips. Hover: lift + "View on Steam".
     Owned items are hidden by default; when shown they carry an "Owned" ribbon. Wishlisted items show a heart.
   - Infinite scroll in chunks of 60.
3. Details drawer (right, 460 px, slides in): large art, title, price, discount, score with a three-segment breakdown bar,
   rating + count + label, release date, tags, short description, buttons: "Open on Steam" (browser), "Open in Steam app" (`steam://store/<appid>`), Close (Esc).
4. Settings modal: Region (country select) + language, score weights (three sliders), scan depth, account section (sign in/out, API-key fallback), About (version, licenses line).

States: skeleton cards while loading; thin top progress bar + "Scanning Steam · 1,500 / 3,000"; empty state with a one-line explanation and "Loosen filters";
error toast with Retry; offline banner; session-expired banner with "Sign in again".

Visual language
- Tokens: bg #0b0f14, surface rgba(255,255,255,.04) with 1px rgba(255,255,255,.08) border and backdrop blur, text #e6edf3 / #9aa7b4,
  accent #4fc3f7 (Steam-ish blue), success #8bd450 (discount green), warning #f5b942, danger #ff6b6b.
- Type: "Segoe UI Variable Text", Inter, system-ui. 13/14 px body, 20 px titles, tabular numerals for prices and scores.
- Radius 12 (cards), 999 (chips). Shadows soft and low. Motion 160–220 ms ease-out; respects `prefers-reduced-motion`.
- Everything keyboard reachable; focus rings visible; images have alt text.

## 8. Security and privacy

- We never ask for, read, or store a Steam password. Sign-in happens on Steam's own page in an isolated window.
- The only cookie the app reads is `steamLoginSecure` on `store.steampowered.com`, to learn the SteamID64.
- Session cookies live in Electron's `persist:steam` partition on the user's machine. Sign out wipes them.
- Settings (and the optional API key) live in `%APPDATA%/Steam Deals/settings.json`, never leave the machine.
- No telemetry. No third-party requests except Steam domains.
- Renderer CSP: `default-src 'self'; img-src 'self' https://*.steamstatic.com https://*.akamaihd.net data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'none'`.

## 9. Build and distribution

- `npm run start` runs the app from source. `npm run dist` builds `release/Steam Deals Setup <version>.exe`.
- electron-builder: `appId com.steamdeals.app`, `productName "Steam Deals"`, NSIS x64, `oneClick: false`, per-user,
  allow changing install dir, desktop shortcut, Start Menu shortcut, uninstaller.
- Unsigned: Windows SmartScreen shows "unrecognized app" on first run; the user clicks More info → Run anyway. Documented in README.
- Icon: procedural (rounded square, blue→green gradient, white percent mark) rendered by `scripts/make-icon.py` to PNG (256) and multi-size ICO.
- Not affiliated with Valve. "Steam" is a Valve trademark; the app uses the word descriptively and no Valve logos.

## 10. Acceptance checklist

- [ ] `npm start` opens the sign-in screen; guest mode loads deals with progress and renders cards with art.
- [ ] Sign in through Steam opens Steam's login page; after login the drawer closes, the account chip shows name + avatar.
- [ ] Owned games are hidden; count of hidden owned shown in the stats strip. Wishlist-only works.
- [ ] Filters, sort, search, tags, and weights all re-rank instantly without refetching.
- [ ] Details drawer opens on click, Esc closes, both Steam links work.
- [ ] Refresh bypasses cache; cached reopen is instant.
- [ ] Sign out clears session; app returns to sign-in screen.
- [ ] Installer builds, installs per-user, creates shortcuts, app launches with correct icon and title, uninstaller works.
- [ ] No console errors; no CSP violations; no network from the renderer.

## 12. Personalization ("For you")

Two toggles in the top bar, both persisted:
- View: **For you** (taste-ranked; signed-in only) | **Browse** (plain score ranking).
- Catalog: **On sale** (discounted games only; min-discount filter applies) | **All games** (whole catalog; discount drops out of the score).

Taste profile (main process, `buildTaste`)
1. Library with playtime: `pointssummary/ajaxgetasyncconfig` on the store session yields a `webapi_token`; `IPlayerService/GetOwnedGames`
   with `access_token` returns owned games with `playtime_forever` and `playtime_2weeks`. Fallbacks: API key, then plain userdata (no playtime).
2. Sample: everything played in the last two weeks, the 160 most-played, then a spread of unplayed games, up to 220.
3. Fingerprint = owned appids + hours (to the hour) + recent hours. Unchanged fingerprint → reuse the cached profile. This runs on
   every launch and refresh, so the profile follows what the person is playing now.
4. Tags: `IStoreBrowseService/GetItems` (50 per request, weighted tags). A persistent appid→tags cache means a rebuild only fetches newcomers.
5. Weights per game: `w = 1 + log2(1 + hours)` (0.35 if unplayed; 1 if no playtime data), `+ 1.5 + log2(1 + recentHours)` when played in the last two weeks.
   Affinity[tag] = Σ w · tagWeight, normalized to shares. Anchors = top-80 weighted games with their tag vectors, for explanations.

Matching (renderer, `tasteModel`)
- Baseline tag share = mean tag weight across all scanned items. `lift[tag] = clamp(log2((affinity + ε) / (baseline + ε)), −2.5, 3)`.
- `raw(game) = Σ tagWeight · lift`. Across the current pool: `match = 100 / (1 + e^(−1.4·z))` where z is raw's z-score.
- `recScore = p · match + (1 − p) · dealScore`, `p` = "Taste over deal" slider (default 60%). Quality floor in For-you: rating ≥ 80, reviews ≥ 300.
- Explanations: top positive tag contributions, and "Because you played X · Y" = anchors with cosine similarity ≥ 0.28 to the game's tag vector.
- "Your taste" panel shows the top-12 tags by affinity × positive lift, most-played and recently played anchors; collapsible (Hide/Show), persisted.

Streaming
- The scan emits each page (`deals:partial`) as it arrives; the renderer renders and re-ranks every ~700 ms while the scan continues,
  without resetting scroll. Depths: 3,000 / 10,000 / 25,000, or everything on sale (~70k items; the full catalog of ~240k stays capped at 25k).

## 13. Basket and Steam cart

- Basket = `settings.basket` (appid, packageid, name, prices, discount), persisted like other settings. Toggle on cards and in the drawer;
  top-bar button shows count + subtotal; the panel reuses the drawer. Totals: subtotal, savings, tax estimate, total.
- Tax: `core.TAX_REGIONS` (US state base rates, Canadian GST/HST/PST, "included", "none", "custom"). US/CA default to "choose";
  all other countries default to "included". Always labelled an estimate; Steam's checkout is the authority.
- Steam's cart is account-wide and only changeable with the store session's `webapi_token`, via `IAccountCartService`
  (`GetCart`, `AddItemsToCart`, `RemoveItemFromCart`, `user_country` must match the account). Verified 2026-10-04: the legacy
  `/cart/` form, GET links, and API keys all fail; CORS to api.steampowered.com is allowed only for the store origin.
- Desktop: `cart:add/get/remove` IPC use the signed-in session's token directly; success shows Steam's subtotal, "Open cart in
  Steam app" (`steam://openurl/https://store.steampowered.com/cart/`), and an Undo that removes the added line items.
- Website primary path (no install): one "Open in Steam" button per basket game (`steam://store/<appid>` on desktop,
  `https://store.steampowered.com/app/<appid>/` on phones so the Steam mobile app opens it), tracked as opened, then
  "Open my Steam cart". The user explicitly wants no requirement to download the Steam Deals app and no bookmarklets.
- Website order (user's decision): per-game "Open in Steam" list first (universal), then "Faster: the Steam Deals Windows app".
- Phone ↔ PC pairing (`web/api/pair.js`, Redis): the desktop basket's "Pair with your phone" asks the relay for a 6-char code
  (10 min) bound to a random 32-hex `pairId`; the phone's website basket claims the code and keeps the `pairId` in
  localStorage; the desktop keeps it in settings. Phone "Send all to my PC's Steam cart" → relay box (ids only, 24 h) →
  desktop polls every 12 s (single in-flight guard) → `receiveFromPhone` merges the basket and, with `pairAutoCart` on,
  adds only the packages not already in the cart via the session token → acks `added|received|failed` with the result →
  the phone polls status and shows "Added N games · Steam subtotal". Steam's cart is account-wide, so the phone's Steam app
  shows it for checkout. Verified live 2026-10-04. Server-initiated QR/mobile-approval login was built, tested and removed:
  Steam shows the Vercel server's location (Ashburn, VA) as suspicious and kills the challenge.
- Website optional shortcut on Windows: hands the basket to the desktop app, never to a bookmark/script (a bookmarklet version was built, verified
  and then removed as too alarming for ordinary users). The app registers the `steamdeals://` scheme (electron-builder
  `protocols`, plus `setAsDefaultProtocolClient` in dev). `steamdeals://cart?items=<appid>:<packageid>,…&v=1` arrives via
  `second-instance` argv (Windows) or `open-url`; the renderer resolves unknown appids with `items:lookup` (GetItems) and
  opens the basket. On Windows browsers the website uses that link and detects "didn't open" by the page keeping focus.
  Elsewhere (phones, Mac, Linux) it shows a 6-character **basket code** (`web/api/basket.js`, Redis, 24 h TTL, ids only)
  that the desktop basket's "Have a basket code?" field imports. Phones also get per-game `steam://store/<appid>` buttons.
  `steam://purchase/<sub>` and other client protocol commands were tested and do not touch the account cart.
- Phones/tablets: PWA manifest + icons, safe-area padding, filters drawer, full-width basket/drawer, bigger touch targets.
- Responsive layout (v1.5.0), one stylesheet for both apps. Breakpoints: ≤860px wide or ≤500px tall = "narrow"
  (`NARROW` in app.js): the sidebar becomes an off-canvas filters sheet and the For-you/Browse, On-sale/All-games and
  sort controls move out of the fixed top bar into the scrolling area (`placeViewbar()` moves the `.viewbar` node
  between `#viewbar-top` and `#viewbar-slot`; banners and the stats line already live in the scroller). ≤640px wide
  or ≤500px tall = "phone" (`PHONE`): a 55px top bar (filters, brand, search icon, basket, account), tap-to-open search,
  one compact horizontal row per game (124px art, 2-line title, price, rating, +; tags hidden), two such columns on
  landscape phones, text-only toggles, the taste panel collapsed by default (`showTastePhone`), Refresh moved into the
  account menu, full-screen settings dialog, scrollable login card. 861–1100px (tablets in landscape) keeps the docked
  sidebar but lets the top bar wrap. Verified with CDP viewport sweeps at 360×640, 375×553, 390×660, 412×830,
  430×740, 844×330, 768×1000, 820×1150 and 1024×740: fixed chrome is 55px on every phone size (was ~470px).

## 14. Shared basket and live cart sync (v1.6.0)

Supersedes the one-shot phone→PC hand-off in §13 (the relay still answers `send/inbox/ack/status` for older apps).

- **Roles.** The Windows app is the complete product on its own (browse, For-you, basket, and now a Steam cart
  kept in step with the basket). Paired with the website it is the bridge: every paired phone/browser and the
  app share one basket, and the app mirrors that basket into the real Steam cart.
- **Relay** (`web/api/pair.js`, Upstash Redis, free plan ≈500k commands/month). Keys per pairing id (32 hex):
  `sd:pair:<id>` meta {createdAt, claimedAt, devices}; `sd:basket:<id>` {rev, items[{appid, packageid, name,
  price, priceCents, originalCents, discount}], updatedAt, by}; `sd:sig:<id>` HASH {rev, active, pc, pcok, pcv}
  (the cheap poll record); `sd:cart:<id>` the PC's report {status{appid:{s,msg,at}}, subtotal, count}. All
  live 365 days past last use. `sd:paircode:<code>` → id, 10 minutes. Actions: `start` (with pairId = another
  code for the same pairing, so more devices can join), `claim`, `check` (devices count; the app treats
  "claimed" as devices > count at start), `sig` (HGETALL; touch=true marks a phone active for 2 min; pc={ok,v}
  is the PC heartbeat; withCart adds the cart report; 404 bad_pair when the hash is gone), `basket.get`,
  `basket.ops` (add/remove/clear, sanitized, max 100 items, applied with a Lua compare-and-set on the rev and
  retried up to 4×; verified with 6 parallel adds), `cart.set`, `unpair` (deletes everything).
- **Budget-aware polling.** Website: while visible and paired, `sig` (+cart) every 4 s and a touch every 45 s;
  pulls the basket only when rev changed; stops when the tab is hidden. Desktop (`src/main/sync.js`): `sig`
  every 3 s while a phone is active or within 60 s of a change, else every 30 s; heartbeat on fast ticks and at
  least every 5 min; reconciles the Steam cart on changes and on a 1 min (fast) / 5 min (slow) heartbeat. An
  idle paired PC costs ≈2.9k commands/day. (Superseded in v1.15.2: see §15, busy mode and quiet rates.) Unpaired, the desktop still reconciles its own basket every 5 min
  and on every basket edit.
- **Mirroring rules** (`reconcileOnce`): GetCart → for each basket item with a packageid: in cart → "added";
  not in cart and never added by us → add; not in cart but in `settings.mirror` (we added it) → not re-added:
  if now owned → "owned" and dropped from the basket (ops by pc), else "removed_on_steam". Items that left the
  basket are removed from the cart only if they are in `mirror` (never hand-added cart lines). Statuses:
  added, failed, no_package, needs_steam, removed_on_steam, owned. Reported to the relay via `cart.set` when
  changed (or every 10 min) and to the renderer as `cart:status`.
- **Desktop plumbing.** `settings:update` with `basket` → `sync.onLocalBasketChange(prev, next)` → ops to
  relay (+ reconcile). Relay rev change → `pull` → `settings.basket` replaced, `basket:replaced` to the
  renderer, reconcile. `settings.mirror` and `basketRev` persist; `REPLACE_KEYS` in settings.js stops
  deepMerge from resurrecting removed mirror entries. Pairing dropped (404) → pairId cleared quietly.
- **Tray.** `createTray` (icon from `build/icon.ico`, now packaged); X hides to tray when `closeToTray`
  (default on; balloon once); tray menu: open, pause syncing, close-to-tray, start with Windows, quit.
  `startWithWindows` → `app.setLoginItemSettings({openAtLogin, args:["--hidden"]})`, packaged only; the app
  opens maximized with `--maximized`, or hidden with `--hidden` when "Open closed to the tray" (`startMinimized`, default off, enabled only while Start with Windows is on) is set (v1.8.3). `backgroundThrottling:false` keeps the hidden renderer responsive.
  Notifications (main process) when the window is hidden/unfocused: games from the phone added/removed,
  sign-in needed, cart failures (rate-limited per kind).
- **Renderer.** Basket rows carry a `.cart-badge` per game; the send panel is "Synced with your Steam cart"
  (desktop, with Check now / Switch to a Send button) or "Synced with your PC's Steam cart" (website, with PC
  status line, per-game Open in Steam in a `<details>`, Unpair this device); unpaired website shows the
  per-game buttons then the Windows-app promo (benefits, direct download, /app, pairing-code field, and on
  Windows the steamdeals:// hand-off). Settings → "Windows app" group (desktop toggles; website explanation +
  link). Login screen links to /app on the website.
- **Verified 2026-10-04** against the real Steam cart with POSTAL 2 ($0.99): phone add → cart within ~9 s,
  phone remove → cart emptied, PC add/remove → phone basket follows, PC unpair → phone forgets. Cart left empty.

## 15. Shared preferences (v1.15.0)

- **What.** One relay document per channel (`sd:prefs:<id>`, revision `prev`): `tasteTags`, `filters`
  `{values, at}` (view, catalog, sort, minDiscount, minRating, minReviews, scanDepth, weights, personalWeight,
  hideOwned, wishlistOnly, selectedTags, deckMachineOnly), `dismissed` + `restored` marks, `behavior` +
  `behaviorClearedAt`. Country and language are not shared. Cleaning and merging: `src/shared/sharing.js`, used by
  the app, the website and the relay.
- **Merge.** Filters: the newer set wins whole. Not interested: per game, newest dismiss or restore. Behaviour:
  union, newest 300, minus anything before the last reset. Taste edits: newest wins, combined on first pairing.
- **Writes.** Each host stamps local changes (`notePrefsEdit`) and pushes the whole document compare-and-set; a
  change during a write triggers one more write; each side pulls once at launch. `prefs.set` from an app before
  1.15 (tasteTags only) keeps the rest. Relay body limit raised to 400 KB for this document (a full one is ~80 KB).
- **Renderer.** `settings:changed` → `onSettingsFromElsewhere` (app.js): redraws top bar, sort and sidebar;
  rescans when catalog, scan depth or the scan floor changed; otherwise re-ranks in place.
- **Busy mode (v1.15.1).** `sig` takes `me` (device tag: "pc" or a browser's random 8-char tag) and `busy`
  (in use now); the relay keeps `busy:<tag>` = now + 30 s in the signal hash (expired ones deleted on the next
  write) and answers `busy` = another device is in use. In use: the app's window focused and system idle < 25 s
  (checked locally every 2 s; the start of use triggers a poll at once); a website tab with input in the last 25 s
  (the first input after a pause polls at once). Polling: 1 s while another device is in use; otherwise website
  10 s, app 10 s (tab open or recent change) / 30 s.
- **Quiet rates (v1.15.2), to stay on the free plan.** App: 2 min when nobody is around, heartbeat every 10 min
  (website's "PC online" window 12 min) → ≈1k commands/day for an app left running (was ≈2.9k). Website: 10 s
  while used, 2 min after 5 quiet minutes, asleep after 30 (wakes on input, focus or coming back); only a tab used
  in the last 5 minutes marks the channel active, so a tab left open doesn't keep the PC checking every 10 s.
- **Verified 2026-10-07** with a packaged 1.15.0 test copy and the live website (code pairing): website → app in
  ~1 s, app → website in ~2 s (sort, catalog, reviews, Deck only); Not interested added on the website reached the
  app, restored in the app and stayed restored on the website.

## 11. Work plan

1. Scaffold package.json, install Electron + electron-builder, .gitignore, README.
2. Icon script → build/icon.png + icon.ico.
3. Main: settings.js, cache.js, steam.js (with a CLI self-test), auth.js, main.js + IPC.
4. preload.js.
5. Renderer: tokens + shell + sign-in screen.
6. Renderer: browse view (sidebar, grid, cards, progress, infinite scroll).
7. Renderer: details drawer, settings modal, account menu, toasts, empty/error states.
8. Run from source, smoke test guest flow, fix.
9. `npm run dist`, install the built installer, verify shortcuts/icon/launch.
10. Final README (install, SmartScreen note, privacy, dev).
