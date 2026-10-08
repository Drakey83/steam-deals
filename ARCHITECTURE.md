# How the code is organised

Steam Deals is one interface shared by two hosts: the Windows app (Electron) and the website (static files plus
Vercel functions). Both hand the interface the same `window.steamDeals` API, so the interface never knows or
cares which one it is running in. There is no bundler: browsers load the ES modules directly.

```
src/
  renderer/                 the interface (desktop app and website)
    app.js                  entry point: startup, keyboard, which redraws follow which event
    state.js                the one shared state object, saving settings changes, the taste-model cache
    data.js                 loading deals, library and taste profile; announces changes, never draws
    history.js, alerts.js,  price history loading, price-alert checks, recording behaviour for For you
    learning.js             (each: talk to window.steamDeals / settings, maths in logic/)
    router.js               switching between the sign-in and browse screens
    config.js               option lists and defaults
    lib/                    dom helpers, icons, formatting, the event hub, platform access
    logic/                  pure maths, no DOM (unit-tested): ranking, taste model and hand edits, basket
                            totals, dismissals, behaviour blend, price history, price alerts
    ui/                     shared widgets: toasts, progress bar, drawer/modal/menu, tooltips (every `title`
                            becomes a styled card; touch: press and hold), small bits
    views/                  screens and panels: login, shell (top bar), sidebar, feed (cards), foryou (the
                            Your taste panel), taste-tags (editing it), details, basket, cart (Steam-cart
                            section), web-cart, pairing, alerts, dismiss, settings, account, updates
    styles.css              imports styles/01-…16-*.css in cascade order (responsive rules last-ish)
    index.html              the desktop page (the website has its own in web/src)
  main/                     the Windows app's main process
    main.js                 entry point: single instance, startup, wiring
    window.js, tray.js      the window (hide to tray on close, tray click toggles) and the tray menu
    deeplink.js             steamdeals:// links from the website
    ipc/                    what the interface can ask for: app, account, catalog, cart (+ pairing),
                            history (via the website, cached), alerts (Windows notifications)
    steam-session.js        keeping the Steam store session usable (renew, then retry)
    library.js              the library and the taste profile
    pairing.js              the relay client, and the one sync engine instance
    account-sync.js         signed in to Steam: join the account's own sync channel (no code)
    updates.js              updating from inside the app (electron-updater + GitHub releases, latest.yml)
    sync/                   the sync engine: index.js polls the relay and keeps the shared basket;
                            cart-mirror.js keeps the real Steam cart matching it; shared-alerts.js and
                            shared-prefs.js bring in and write back price alerts and the shared preferences
    steam.js, auth.js       Steam HTTP calls; Steam's own login page in an isolated window
    settings.js, cache.js   settings.json and a small TTL cache in the user's AppData
  preload.js                the only bridge from the interface to the main process
  shared/core.js            pure logic used everywhere (normalising store items, taste profile, tax, basket
                            diffs). CommonJS in Node, window.SteamCore in browsers.
  shared/sharing.js         what paired devices share, how two copies merge and how the relay cleans them (price
                            alerts, preferences). CommonJS in Node, window.SteamSharing in browsers.
web/
  src/                      the website's page, /app page, and its implementation of window.steamDeals
    web-api.js              assembles window.steamDeals from browser-api/*
    browser-api/            settings in localStorage, calls to /api, deals, taste, startup, and syncing:
                            pairing.js (joining by Steam account or code, polling, the shared basket),
                            shared-alerts.js, shared-prefs.js, relay.js
  api/                      Vercel functions (11 of the Hobby plan's 12): deals, tags, items, me/owned (library),
                            auth/[action] (Steam OpenID sign-in, and "link": a device's account sync channel),
                            pair (the relay), stats (counter), geo, config, history (IsThereAnyDeal, key
                            server-side only)
    _lib/                   shared server code: server.js (responses, session cookie), redis.js, itad.js,
                            auth/ (sign-in steps, account link), relay/ (the relay's actions by area:
                            channel, basket, shared-docs, legacy; its records in keys.js; input cleaning)
  public/                   generated by `npm run web:build` (do not edit)
test/                       unit tests (node:test): logic, shared core and sharing rules, the sync engine
                            against a fake Steam cart and a fake relay
scripts/                    website build/serve, import checker, live relay test, DevTools driver, icon
```

## How devices stay in sync

Every device on a **channel** shares one basket, the Steam-cart status, price alerts and the preferences through
the relay (`web/api/pair.js`). The preferences are everything that decides what the list shows and how Your taste
comes out: the view, sale/all, sort, sidebar filters, scan depth, score weights, Your taste edits, Not interested
and the behaviour log. Store region and language stay per device. A device gets onto a channel in one of two ways:

- **Steam account** (automatic). The website signed in through Steam proves its account with its session cookie;
  the Windows app signed in to Steam shows the site its short-lived Steam store token once, which the site checks
  with Steam and doesn't keep. Both get the same channel id, derived from the Steam ID with the site's secret.
- **Code** (manual). For a guest browser or an API-key sign-in: a six-character code from the Windows app.

Each shared document has a revision in the channel's signal record, so a poll fetches only what changed. Writes
are compare-and-set; a refused write returns the current copy to merge. The merge rules, and the cleaning the relay
applies, are in `src/shared/sharing.js` (the website build copies it to `web/api/_lib/`):

- **Filters** travel as one set with the time of the last change (`filtersAt`); the newer set wins.
- **Not interested** keeps restore marks (`dismissRestored`), so an undo on one device isn't brought back by
  another; per game, the newest dismiss or restore wins.
- **Behaviour** is the union of every device's events; "Reset my recommendations" (`behaviorClearedAt`) forgets
  everything older everywhere.
- Each host stamps these on a local change (`notePrefsEdit`, in its settings update), so the interface knows
  nothing about syncing. A change arriving from elsewhere comes in as `settings:changed`; `app.js`
  (`onSettingsFromElsewhere`) redraws, and rescans only when the scan itself changed.
- **Busy mode** decides how often devices check (the relay's free plan has a monthly command budget shared by
  everyone). A device in use (app window focused with recent input; a website tab with a recent click, tap, key or
  scroll) says so on its polls (`sig` with `me`, `busy`), and every *other* device then checks every second, so
  a change shows within about a second. Otherwise, to stay on the free plan: a website tab every 10 s while used,
  every 2 min after 5 quiet minutes, not at all after 30 (input or coming back wakes it); the app every 10 s
  while a tab is being used or after a change, every 2 min when nobody is around, "I'm here" every 10 min. Each
  side also compares with the relay once at launch, so a change that didn't get out is sent then.
- Apps before 1.15 write only Your taste edits; the relay keeps the rest of the document for them.
- **Website tabs update themselves.** Each deploy stamps a build id into `web-api.js` and `/version.json`; an open
  tab checks every 5 minutes and on focus (browser-api/updates.js), and on a newer build reloads quietly once it's
  in the background (or offers Reload meanwhile), so no tab keeps syncing with old code.

## Deals, the wishlist and images

- **Scans** ask Steam for one of a few fixed discount floors (50%, 25%, 10%, any; `scanFloor` in shared/core.js),
  the one that covers the person's minimum, so scans are shared and cached; the device narrows to the exact
  minimum. Lowering the minimum below the current scan's floor starts a new scan.
- **The wishlist** isn't left to the scan: signed in, every wishlist game the scan missed is looked up directly
  (data.js `addWishlistGames`), and with Wishlist only on, the bargain minimums don't apply (logic/ranking.js).
- **Images**: newer games have no plain `steam/apps/<appid>/header.jpg`; Steam lists a hashed path in the game's
  data. Every Steam request asks for it (`include_assets`), `normalizeItem` builds the image from it, the website
  keeps it end to end, and every image falls back to the plain address once before hiding (`imgEl`).

## Releasing

`npx electron-builder --win --x64 --publish never` writes `Steam-Deals-Setup-<version>.exe`, its `.blockmap` and
`latest.yml`. A release must carry all three (the app's updater reads `latest.yml`), plus a copy named
`Steam-Deals-Setup.exe`, which the README's and the /app page's download links point at.

## Rules of thumb

- **Layers point one way.** `logic/` and `lib/` know nothing about views. `data.js` and `state.js` change data
  and announce it through `lib/events.js` (`EV.*`); `app.js` decides what redraws. Views may call each other.
- **No network in the interface.** Everything goes through `window.steamDeals`. On the desktop, all network
  traffic happens in the main process (the page's CSP has `connect-src 'none'`). Syncing happens below that API
  on both hosts; the interface only hears about it through settings and basket events.
- **One module, one job.** When a file starts doing two things (the sync engine did five), split it by job and
  keep the outside interface the same, so callers and tests don't change.
- **Pure logic gets a test.** Anything in `logic/`, `shared/` or `main/sync/` that changes behaviour should come
  with a test in `test/`.
- **Every change is saved.** `patchSettings` combines quick changes and always writes them; nothing waiting is
  dropped, and anything waiting is written when the window is hidden or closed.
- **Paired alerts have one owner.** Alerts made on the website go to the relay; the paired Windows app (1.10+)
  merges them into its list, checks them with its own and notifies. The website then doesn't check them
  (`alertsCheckedByPc`), so a crossing is announced once. The app owns check state, the website owns which
  alerts exist.
- **Keep the CSS order.** Files in `src/renderer/styles/` are numbered; later files may override earlier ones.

## Checks

```bash
npm run check        # lint + import check + unit tests (runs automatically before dist and web:deploy)
npm run test:relay   # live test of the pairing relay against the production site (throwaway pairing)
```
