// The one shared, mutable app state, plus the few helpers that read or change it.
// Views read state directly; changes that need a redraw are announced through lib/events.js.

import { NON_RESULT_KEYS } from "./config.js";
import { EV, emit } from "./lib/events.js";
import { api } from "./lib/platform.js";
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
let model = null;
let modelFor = { taste: null, deals: null };
/** Call after changing state.deals in place (streamed pages append to the same array). */
export function invalidateTasteModel() {
  modelFor = { taste: null, deals: null };
}
export function tasteModel() {
  if (modelFor.taste !== state.taste || modelFor.deals !== state.deals) {
    model = buildTasteModel(state.taste, state.deals);
    modelFor = { taste: state.taste, deals: state.deals };
  }
  return model;
}

/**
 * Change settings locally and persist them (debounced unless persistNow). Announces whether the
 * results need recomputing or the deals need re-scanning.
 */
let saveTimer = null;
export function patchSettings(patch, { refetch = false, persistNow = false } = {}) {
  state.settings = { ...state.settings, ...patch };
  clearTimeout(saveTimer);
  const save = () => api.settings.update(patch);
  if (persistNow) save();
  else saveTimer = setTimeout(save, 300);
  if (refetch) emit(EV.refetch);
  else if (Object.keys(patch).some((k) => !NON_RESULT_KEYS.has(k))) emit(EV.resultsStale);
}
