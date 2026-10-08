// The one shared, mutable app state, plus the few helpers that read or change it.
// Views read state directly; changes that need a redraw are announced through lib/events.js.

import { NON_RESULT_KEYS } from "./config.js";
import { EV, emit } from "./lib/events.js";
import { Core, api } from "./lib/platform.js";
import { withBehavior } from "./logic/behavior.js";
import { buildTasteModel } from "./logic/taste.js";

export const state = {
  settings: null,
  account: null,
  tags: {}, // tag id → name
  deals: [],
  meta: { total: null, fetchedAt: null, fromCache: false, truncated: false },
  library: emptyLibrary(),
  loading: false,
  error: null,
  query: "",
  tagSearch: "",
  results: [],
  ownedHidden: 0,
  personalized: false,
  activeWeights: null,
  shown: 0, // cards rendered so far (infinite scroll)
  selected: null, // the game open in the details panel
  taste: null, // { affinity, anchors, basedOn, hasPlaytime, libraryCount, source, builtAt }
  tasteLoading: false,
  tasteReason: null,
  tasteProgress: null,
  sync: null, // shared-basket / Steam-cart status
  lastSent: null, // manual "Send to my Steam cart" result, for Undo
  openedInSteam: new Set(), // website: games opened one by one in Steam
};

export function emptyLibrary() {
  return { owned: new Set(), wishlist: new Set(), signedIn: false, sessionExpired: false };
}

export const tagName = (id) => state.tags[id] || `#${id}`;

/** A game's art: the path Steam listed for it when it was loaded, else the plain address (older games). */
let images = { deals: null, map: new Map() };
export function gameImage(appid, known = null) {
  if (known) return known;
  if (images.deals !== state.deals) images = { deals: state.deals, map: new Map(state.deals.map((d) => [d.appid, d.image])) };
  return images.map.get(appid) || Core.headerImage(appid);
}

/** Price alerts (logic/alerts.js), newest first. */
export const alertList = () => (Array.isArray(state.settings?.alerts) ? state.settings.alerts : []);

/** What the person did in the app (logic/behavior.js), newest first. */
export const behaviorEvents = () => (Array.isArray(state.settings?.behavior) ? state.settings.behavior : []);

/** Tags put in or taken out of "Your taste" by hand (logic/taste.js). */
export const tasteEdits = () => state.settings?.tasteTags || null;

/** "Not interested" entries (logic/dismiss.js), newest first. */
export const dismissedList = () => (Array.isArray(state.settings?.dismissed) ? state.settings.dismissed : []);

export const basket = () => (Array.isArray(state.settings?.basket) ? state.settings.basket : []);
export const inBasket = (appid) => basket().some((b) => b.appid === appid);

/** Signed in with a real account (not a guest), so For-you is possible. */
export const isPersonal = () => Boolean(state.library.signedIn && state.account && state.account.method !== "guest");
export const viewMode = () => (isPersonal() && state.settings.view !== "all" ? "foryou" : "all");

/** "Best match" only makes sense in For-you; "Best score" only in Browse. Keep the sort consistent with the view. */
export function syncSortWithView() {
  const s = state.settings;
  const before = s.sort;
  if (viewMode() === "foryou" && s.sort === "score") s.sort = "match";
  if (viewMode() === "all" && s.sort === "match") s.sort = "score";
  if (s.sort !== before) api.settings.update({ sort: s.sort });
}

// The taste model depends on the profile and the scanned deals; rebuild it only when either changes.
// (and on the "Not interested" list, whose tags count against, and on what the person did in the app).
let model = null;
let modelFor = { taste: null, deals: null, dismissed: null, behavior: null, edits: null };
/** Call after changing state.deals in place (streamed pages append to the same array). */
export function invalidateTasteModel() {
  modelFor = { taste: null, deals: null, dismissed: null, behavior: null, edits: null };
}
export function tasteModel() {
  const dismissed = dismissedList();
  const behavior = behaviorEvents();
  const edits = tasteEdits();
  const f = modelFor;
  if (f.taste !== state.taste || f.deals !== state.deals || f.dismissed !== dismissed || f.behavior !== behavior || f.edits !== edits) {
    model = buildTasteModel(withBehavior(state.taste, behavior), state.deals, dismissed, edits || {});
    modelFor = { taste: state.taste, deals: state.deals, dismissed, behavior, edits };
  }
  return model;
}

/**
 * Change settings locally and persist them (debounced unless persistNow). Announces whether the
 * results need recomputing or the deals need re-scanning.
 */
// Changes waiting to be written. Quick successive changes (a slider being dragged) are written together after a
// short pause; a change that must land now writes everything still waiting along with it. Nothing is ever
// dropped: before, a second change within the pause cancelled the first one's save.
let saveTimer = null;
let unsaved = {};
function flushSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const patch = unsaved;
  unsaved = {};
  if (Object.keys(patch).length) api.settings.update(patch);
}
/** Write any waiting changes now (e.g. when the page is being hidden or closed). */
export { flushSettings };

export function patchSettings(patch, { refetch = false, persistNow = false } = {}) {
  state.settings = { ...state.settings, ...patch };
  unsaved = { ...unsaved, ...patch };
  if (persistNow) flushSettings();
  else {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSettings, 300);
  }
  if (refetch) emit(EV.refetch);
  else if (Object.keys(patch).some((k) => !NON_RESULT_KEYS.has(k))) emit(EV.resultsStale);
}
