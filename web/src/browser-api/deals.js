// Scanning Steam's sale list through /api/deals: pages fetched four at a time and streamed to the UI.
import { emit } from "./events.js";
import { http } from "./http.js";
import { settings } from "./settings.js";

const Core = window.SteamCore;
const PAGE = 500;
const CONCURRENCY = 4;

let dealsAbort = null;

export function cancelDeals() {
  dealsAbort?.abort();
}

export async function fetchDeals({ force = false } = {}) {
  dealsAbort?.abort();
  const controller = new AbortController();
  dealsAbort = controller;
  const s = settings;
  const discounted = s.catalog !== "all";
  const depth = Number(s.scanDepth);
  let limit = depth === 0 && discounted ? Infinity : Math.min(Math.max(depth || 10000, 500), 25000);
  const runId = Date.now();
  // "Refresh" asks the edge for a newer copy at most every 10 minutes, so Steam isn't hammered.
  const bust = force ? `&r=${Math.floor(Date.now() / 600000)}` : "";
  const qs = (start) => `/api/deals?catalog=${discounted ? "sale" : "all"}&start=${start}&cc=${s.country}&l=${s.language}&v=2${bust}`;

  const first = await http(qs(0), { signal: controller.signal });
  const total = first.total ?? 0;
  if (!Number.isFinite(limit)) limit = total;
  limit = Math.min(limit, total || limit);
  const items = [];
  const seen = new Set();
  let scanned = 0;
  const take = (page) => {
    const fresh = [];
    for (const it of page.items || []) {
      if (seen.has(it.appid)) continue;
      seen.add(it.appid);
      it.tagids = (it.tags || []).map((t) => t.id);
      it.image = Core.headerImage(it.appid);
      it.url = Core.storeUrl(it.appid);
      items.push(it);
      fresh.push(it);
    }
    scanned += page.scanned || 0;
    emit("progress", { fetched: Math.min(scanned, limit), target: limit, total });
    emit("partial", { runId, items: fresh, scanned, total, discounted });
  };
  take(first);

  const starts = [];
  for (let st = PAGE; st < limit; st += PAGE) starts.push(st);
  let next = 0;
  const worker = async () => {
    while (next < starts.length) {
      const st = starts[next++];
      if (controller.signal.aborted) return;
      take(await http(qs(st), { signal: controller.signal }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, starts.length) }, worker));
  if (dealsAbort === controller) dealsAbort = null;
  return { items, total, scanned, discounted, runId, fetchedAt: Date.now(), truncated: scanned < total, fromCache: false };
}
