// Building the visitor's taste profile in the browser (tags for their most-played games, cached locally).
import { emit } from "./events.js";
import { http } from "./http.js";
import { loadLibrary } from "./library.js";
import { settings } from "./settings.js";
import { store } from "./store.js";

const Core = window.SteamCore;
const TASTE_TTL = 3 * 24 * 60 * 60 * 1000;
const TAGS_TTL = 30 * 24 * 60 * 60 * 1000;
const BATCH = 50;

export async function buildTaste({ force = false } = {}) {
  const a = settings.account;
  if (!a || a.method === "guest") return { taste: null, reason: "guest" };
  let lib;
  try {
    lib = await loadLibrary(force);
  } catch (err) {
    if (err.code === "signed_out") return { taste: null, reason: "session_expired" };
    throw err;
  }
  if (!lib || !lib.games.length) return { taste: null, reason: lib?.privateProfile ? "private" : "empty" };
  const key = `sd:taste:${a.method}:${a.steamid}:${settings.language}`;
  const sample = Core.pickSample(lib.games, 220);
  const fingerprint = Core.libraryFingerprint(sample);
  const cached = store.get(key);
  if (!force && cached && cached.fingerprint === fingerprint && Date.now() - cached.builtAt < TASTE_TTL) return { taste: cached, fromCache: true };

  // Tags: remember every game already looked up, so a rebuild only fetches newcomers.
  const tagKey = `sd:itemtags:${settings.language}`;
  const tagStore = store.get(tagKey, null);
  const known = tagStore && Date.now() - tagStore.savedAt < TAGS_TTL ? tagStore.items : {};
  const missing = sample.filter((g) => !known[g.appid]).map((g) => g.appid);
  emit("taste-progress", { done: 0, total: missing.length });
  for (let i = 0; i < missing.length; i += BATCH) {
    const ids = missing.slice(i, i + BATCH);
    const r = await http(`/api/items?ids=${ids.join(",")}&cc=${settings.country}&l=${settings.language}`);
    for (const it of r.items || []) known[it.appid] = { name: it.name, type: it.type, tags: it.tags };
    for (const id of ids) if (!known[id]) known[id] = { name: null, type: -1, tags: [] };
    emit("taste-progress", { done: Math.min(i + BATCH, missing.length), total: missing.length });
  }
  store.set(tagKey, { savedAt: tagStore?.savedAt && missing.length === 0 ? tagStore.savedAt : Date.now(), items: known });

  const items = sample.map((g) => ({ appid: g.appid, ...(known[g.appid] || { name: null, type: -1, tags: [] }) }));
  const taste = Core.buildTasteProfile(sample, items);
  taste.source = a.method;
  taste.libraryCount = lib.games.length;
  taste.builtAt = Date.now();
  taste.fingerprint = fingerprint;
  store.set(key, taste);
  return { taste, fromCache: false };
}
