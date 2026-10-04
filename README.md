# Steam Deals

A Windows desktop app that finds Steam games you'll actually like and aren't already playing.
Sign in with your Steam account and it learns your taste from your library, weighted by how much
you've played each game, then ranks the current sales (or the whole catalog) by how well each game
matches you, with a "because you played …" explanation on every card. Everything you own is hidden.

![sign-in](docs/screenshot-signin.png)
![browse](docs/screenshot-browse.png)

## Install

1. Download `Steam Deals Setup x.y.z.exe` from the Releases page.
2. Run it. Windows SmartScreen will say the publisher is unknown because the installer isn't code-signed.
   Click **More info → Run anyway**.
3. Pick an install folder (or keep the default) and finish. A Start Menu entry and desktop shortcut are created.

The app installs per-user and needs no admin rights. Uninstall from Windows Settings → Apps.

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

- Sign-in happens on Steam's page. The only cookie the app reads is the one that identifies your SteamID64.
- Your Steam session, settings, and caches stay in `%APPDATA%\Steam Deals` on your machine. Sign out wipes the session.
- The app talks only to Steam domains. No telemetry, no third-party services.

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
(the only bridge to the UI), `src/renderer` (vanilla HTML/CSS/JS). `SPEC.md` describes the design in detail.

`scripts/make-icon.py` regenerates the icon (needs Python with Pillow). `scripts/cdp.mjs` drives a running
instance over the DevTools protocol for screenshots and inspection when started with `--remote-debugging-port=9222`.
