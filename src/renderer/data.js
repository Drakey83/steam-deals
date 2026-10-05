// Loading deals, the library and the taste profile. Updates state and announces what changed
// (lib/events.js); it never draws anything itself.
import { EV, emit } from "./lib/events.js";
import { fmtInt } from "./lib/format.js";
import { api } from "./lib/platform.js";
import { invalidateTasteModel, state, syncSortWithView } from "./state.js";
import { learnOwned } from "./learning.js";
import { setProgress } from "./ui/progress.js";
import { toast } from "./ui/toast.js";

const toLibrary = (r) => ({
  owned: new Set(r.owned || []),
  wishlist: new Set(r.wishlist || []),
  signedIn: Boolean(r.signedIn),
  sessionExpired: Boolean(r.sessionExpired),
});

/** Scan deals, read the library and tag names, and (in parallel) build the taste profile. */
export async function loadAll({ force = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.error = null;
  state.tasteLoading = true;
  state.tasteProgress = null;
  setProgress({ label: "Connecting to Steam…" });
  emit(EV.loadStarted);

  // The taste profile builds concurrently; deals render as soon as they arrive. Tag names are applied the
  // moment they come back, so streamed results never show bare tag numbers.
  const tasteP = api.taste.build({ force }).catch((e) => ({ ok: false, error: { message: e.message } }));
  const tagsP = api.tags.fetch().then((r) => {
    if (r.ok) {
      state.tags = r.tags || {};
      emit(EV.tagsLoaded);
    }
  });
  const [libRes, dealsRes] = await Promise.all([api.library.fetch({ force }), api.deals.fetch({ force }), tagsP]);

  if (libRes.ok) {
    state.library = toLibrary(libRes);
    if (state.library.signedIn) learnOwned(state.library.owned);
  }
  else {
    state.library.sessionExpired = false;
    toast(`Couldn't load your library: ${libRes.error.message}`, { type: "err", action: () => loadAll({ force: true }) });
  }
  if (dealsRes.ok) {
    state.deals = dealsRes.items || [];
    state.meta = {
      total: dealsRes.total,
      scanned: dealsRes.scanned || (dealsRes.items || []).length,
      fetchedAt: dealsRes.fetchedAt,
      fromCache: Boolean(dealsRes.fromCache),
      truncated: Boolean(dealsRes.truncated),
      discounted: dealsRes.discounted !== false,
      streaming: false,
    };
  } else if (dealsRes.error.code !== "cancelled") {
    state.error = dealsRes.error;
    toast(`Couldn't load deals: ${dealsRes.error.message}`, { type: "err", action: () => loadAll({ force: true }) });
  }
  state.loading = false;
  stream.run = null;
  setProgress(null);
  syncSortWithView();
  emit(EV.loadFinished);

  applyTaste(await tasteP);
}

/** A setting changed that needs a new scan: stop the current one and start over. */
export function reload() {
  api.deals.cancel();
  state.loading = false;
  loadAll();
}

// Pages arrive while the scan runs; show them right away instead of waiting for the whole depth.
const stream = { run: null, seen: new Set(), timer: null };
export function onDealsPartial(p) {
  if (!state.loading || !p) return;
  if (stream.run !== p.runId) {
    stream.run = p.runId;
    state.deals = [];
    stream.seen = new Set();
  }
  for (const it of p.items || []) {
    if (!stream.seen.has(it.appid)) {
      stream.seen.add(it.appid);
      state.deals.push(it);
    }
  }
  state.meta = { ...state.meta, total: p.total, scanned: p.scanned, discounted: p.discounted !== false, streaming: true };
  invalidateTasteModel();
  if (stream.timer) return;
  stream.timer = setTimeout(() => {
    stream.timer = null;
    if (state.loading) emit(EV.dealsStreamed);
  }, 700);
}

function applyTaste(res) {
  state.tasteLoading = false;
  state.tasteProgress = null;
  if (res?.ok) {
    state.taste = res.taste || null;
    state.tasteReason = res.reason || null;
  } else {
    state.taste = null;
    state.tasteReason = "error";
    if (res?.error?.message) toast(`Couldn't build your taste profile: ${res.error.message}`, { type: "err", action: rebuildTaste });
  }
  emit(EV.resultsStale);
}

export function onTasteProgress(p) {
  state.tasteProgress = p;
  if (state.tasteLoading) emit(EV.tasteProgress);
}

/** Re-read the library and playtime now and rebuild the profile from scratch. */
export async function rebuildTaste() {
  if (state.tasteLoading) return;
  state.tasteLoading = true;
  state.tasteProgress = null;
  emit(EV.tasteLoading);
  const r = await api.taste.build({ force: true }).catch((e) => ({ ok: false, error: { message: e.message } }));
  applyTaste(r);
  if (r?.ok && r.taste) toast(`Taste profile rebuilt from ${fmtInt(r.taste.basedOn)} games`, { type: "ok" });
}

export async function refreshLibrary() {
  const r = await api.library.fetch({ force: true });
  if (!r.ok) return toast(r.error.message, { type: "err" });
  state.library = toLibrary(r);
  if (state.library.signedIn) learnOwned(state.library.owned);
  syncSortWithView();
  emit(EV.libraryChanged);
  if (r.signedIn) toast(`Library refreshed · ${fmtInt(r.owned.length)} games`, { type: "ok" });
  rebuildTaste();
}
