// A minimal publish/subscribe hub. Lower layers (state, data loading, overlays) announce what changed;
// the views subscribe. That keeps data code free of rendering code and avoids circular imports.

const listeners = new Map();

export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name).delete(fn);
}

export function emit(name, payload) {
  for (const fn of listeners.get(name) || []) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[events] ${name} handler failed`, err);
    }
  }
}

/** Every event name in one place: use EV.name rather than a string, so names stay consistent. */
export const EV = Object.freeze({
  resultsStale: "results:stale", // filters, sort, search or deals changed: recompute and redraw the list
  refetch: "deals:refetch", // a setting changed that needs a new scan (region, language, depth, catalog)
  loadStarted: "deals:load-started",
  loadFinished: "deals:load-finished",
  dealsStreamed: "deals:streamed", // a page of a running scan arrived
  tagsLoaded: "tags:loaded", // tag names arrived
  historyLoaded: "history:loaded", // price history arrived for some games (payload: their appids)
  libraryChanged: "library:changed",
  tasteLoading: "taste:loading",
  tasteProgress: "taste:progress",
  basketChanged: "basket:changed", // the basket's contents changed (here or on a paired device)
  basketOpen: "basket:open", // show the basket panel
  modalClosed: "modal:closed",
});
