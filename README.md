# Steam Deals

[![Latest release](https://img.shields.io/github/v/release/Drakey83/steam-deals?label=release&color=4fc3f7)](https://github.com/Drakey83/steam-deals/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Drakey83/steam-deals/total?label=downloads&color=8bd450)](https://github.com/Drakey83/steam-deals/releases)
![Platforms](https://img.shields.io/badge/runs%20on-web%20%7C%20Windows%20%7C%20local-0b0f14)

Find Steam games you'll actually like and aren't already playing. Sign in with your Steam account and
it learns your taste from your library, weighted by how much you've played each game, then ranks the
current sales (or the whole catalog) by how well each game matches you, with a "because you played …"
explanation on every card. Everything you own is hidden.

![sign-in](docs/screenshot-signin.png)
![browse](docs/screenshot-browse.png)

## Three ways to use it

| | What you need | Best for |
|---|---|---|
| **[Website](https://steamdeal.vercel.app)** | A browser | Trying it right now, on any computer or phone |
| **[Windows app](https://github.com/Drakey83/steam-deals/releases/latest)** | Windows 10 or 11 | Everyday use; works with private Steam profiles |
| **Run it yourself** | [Node.js](https://nodejs.org) 20.11+ | Running everything on your own machine, or tinkering |

### Website

Open **https://steamdeal.vercel.app**. Nothing to install. Sign in through Steam, paste your own
Steam Web API key, or browse as a guest. Signing in through Steam needs your profile's **Game details**
set to Public. Using your own key does not. On a phone or tablet, use your browser's **Add to Home Screen**
to keep it as an app.

### Windows app

1. Download `Steam Deals Setup x.y.z.exe` from the [latest release](https://github.com/Drakey83/steam-deals/releases/latest).
2. Run it. Windows SmartScreen will say the publisher is unknown because the installer isn't code-signed.
   Click **More info → Run anyway**.
3. Pick an install folder (or keep the default) and finish. A Start Menu entry and desktop shortcut are created.

The app installs per-user and needs no admin rights. Uninstall from Windows Settings → Apps.
It signs in through Steam's own login window, so it works even if your profile is private.

### Run it yourself

Download the code (green **Code** button → **Download ZIP**, or `git clone`), then in that folder:

```bash
npm install
```

Then either:

```bash
npm start
```

to run the desktop app from source (built and tested on Windows; Electron should also run it on macOS and Linux), or:

```bash
npm run web:local
```

to run the website on your own machine at http://localhost:3000. No accounts needed. The API-key and
guest options work straight away. To turn on "Sign in through Steam" locally, create a file named `.env`
in the folder with your own key and any long random string:

```
STEAM_API_KEY=your-32-character-key
SESSION_SECRET=any-random-string-at-least-32-characters-long
```

## Using it

- **Sign in through Steam** opens Steam's own login page in a window. Sign in there as usual, including Steam Guard.
  The app never sees your password. It only reads which games you own and what's on your wishlist.
- **Browse as guest** shows deals without hiding owned games.
- **Use a Steam Web API key instead** is for people who prefer not to sign in. Get a free key at
  <https://steamcommunity.com/dev/apikey>; your profile's Game details must be public.

Two toggles at the top:

- **For you / Browse.** For you ranks by how well each game matches your taste, blended with the deal score.
  Browse is the plain ranking by score. (For you needs a signed-in account.)
- **On sale / All games.** On sale shows only discounted games. All games covers the whole catalog, so For you
  becomes "the highest-rated games I'd probably like, whether or not they're on sale."

**Basket.** Press **+** on any game to collect sales. The basket shows the subtotal, what you're saving, an
estimated tax for your state or province (Steam adds US and Canadian sales tax at checkout; elsewhere prices
already include it), and the total. When you're ready, **Send to my Steam cart** puts everything in your real
Steam cart. Nothing is purchased: you review and pay in Steam's own checkout, in the Steam app, the website,
or on your phone, since the cart belongs to your account.

- In the **Windows app**, one click does it (you need to be signed in through Steam). Undo removes the games again.
- On the **website**, Steam only lets its own app change your cart, so the basket opens each game in Steam
  (the Steam desktop client on a computer, the Steam mobile app on a phone) with its Add to Cart button ready.
  Go down the list, then open your cart in Steam to pay. Nothing to install. If you do have the Steam Deals
  Windows app, an optional shortcut sends the whole basket to it in one go: a `steamdeals://` link on Windows,
  or a six-letter basket code from a phone, Mac or Linux (codes last 24 hours and hold only the games).

Filters live in the left sidebar: minimum discount and rating, minimum review count, tags, hide-owned and wishlist-only.
Click any card for details, a score breakdown, and why it matched you, plus buttons to open the store page in your
browser or in the Steam client.

**How the taste profile works.** The app reads your library with playtime, picks the games you've played most
(plus everything played in the last two weeks), and builds a weighted profile of Steam's store tags from them.
Each candidate game's tags are compared against that profile relative to the whole catalog, so ubiquitous tags like
"Singleplayer" don't count for much while distinctive ones do. The profile is re-checked on every launch and refresh:
when your library or hours change, it's rebuilt, so it keeps up with what you're playing now. Tags for games it has
already seen are cached, so a rebuild is a handful of requests. You can collapse the "Your taste" panel with Hide.

**Deal score** = 40% discount + 35% positive-review percentage + 25% popularity, where popularity is the review
count on a log scale relative to the most-reviewed game in your current results. In All-games mode the discount
term drops out. The For-you ranking blends taste match and deal score; the "Taste over deal" slider in Settings
sets the mix. All weights are adjustable.

Settings also has the store region and language (prices follow the region) and the scan depth: 3,000, 10,000 or
25,000 most-popular items, or everything on sale (about 70,000 items, two to three minutes). Results stream in as
pages arrive, so the first cards show up in about a second at any depth.

## Privacy

- Sign-in always happens on Steam's own page. Neither version ever sees your password.
- **Windows app:** the only cookie it reads is the one that identifies your SteamID64. Your Steam session,
  settings, and caches stay in `%APPDATA%\Steam Deals`. Sign out wipes the session. It talks only to Steam,
  plus one request to steamdeal.vercel.app to guess your state or province for the basket's tax estimate
  (nothing is stored there; you can change the region by hand).
- **Basket tax estimate:** the region is guessed from your connection's location and can be changed in the basket.
- **Website:** settings and any API key you add stay in your browser. Your key is passed through to Steam
  and never stored on the server. The visitor count is anonymous: one random id per browser, nothing tied
  to you or your Steam account. No ads, no tracking.

Not affiliated with Valve Corporation. Steam is a trademark of Valve Corporation.

## Development

Requires Node 20.11 or newer.

```bash
npm install
npm start               # run from source
npm run selftest        # hit the Steam endpoints from plain Node
npm run dist            # build release/Steam Deals Setup x.y.z.exe
```

Layout: `src/main` (Electron main process: window, Steam HTTP, sign-in, settings, cache), `src/preload.js`
(the only bridge to the UI), `src/renderer` (vanilla HTML/CSS/JS, shared by the desktop app and the website),
`src/shared/core.js` (scoring and taste logic, shared by both). `SPEC.md` describes the design in detail.

**Website** (`web/`): static page plus serverless functions on Vercel's free Hobby plan. `web/src/web-api.js`
implements the same interface the desktop preload exposes, backed by `web/api/*`. Deal pages are cached at
Vercel's edge for three hours, so every visitor shares one scan. "Sign in through Steam" is Steam's OpenID
login; it is enabled when the project has `STEAM_API_KEY` and `SESSION_SECRET` (32+ chars) set as
environment variables. A visitor's own API key stays in their browser and is passed through to Steam only.

```bash
npm run web:local       # run the website locally (plain Node, no accounts)
npm run web:build       # assemble web/public from the shared sources
npm run web:deploy      # build and deploy to production (needs `vercel login` and a linked project)
```

`scripts/make-icon.py` regenerates the icon (needs Python with Pillow). `scripts/cdp.mjs` drives a running
instance over the DevTools protocol for screenshots and inspection when started with `--remote-debugging-port=9222`.
