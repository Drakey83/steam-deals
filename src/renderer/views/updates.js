// Updating the Windows app (main/updates.js does the work): the "Updates" row in Settings, and a one-time notice
// when a new version has downloaded and is ready to install. Desktop only; the website reloads itself instead.
import { el } from "../lib/dom.js";
import { timeAgo } from "../lib/format.js";
import { api } from "../lib/platform.js";
import { toast } from "../ui/toast.js";

const hasUpdater = () => Boolean(api.updates?.check);
let current = null;
const listeners = new Set();

/** Follow the updater's status, and say once when an update is ready to install. Call once at startup. */
export function initUpdates() {
  if (!hasUpdater()) return;
  let announced = null;
  const seen = (st) => {
    current = st;
    for (const fn of listeners) fn(st);
    if (st?.state === "ready" && announced !== st.version) {
      announced = st.version;
      toast(`Steam Deals ${st.version} is ready. Restart to update; your basket and settings stay.`, { type: "ok", action: () => api.updates.install(), actionLabel: "Restart now", timeout: 60000 });
    }
  };
  api.updates.onStatus(seen);
  api.updates.status().then((r) => r?.ok && seen(r.status));
}

function describe(st) {
  if (!st) return "Checking…";
  const v = `Version ${st.current}`;
  switch (st.state) {
    case "checking": return `${v} · checking for updates…`;
    case "current": return `${v} · up to date${st.checkedAt ? ` (checked ${timeAgo(st.checkedAt)})` : ""}`;
    case "downloading": return `Version ${st.version} is downloading… ${st.percent || 0}%`;
    case "ready": return `Version ${st.version} is ready to install (you have ${st.current}).`;
    case "error": return `${v} · ${st.error}`;
    case "unavailable": return `${v} · ${st.error}`;
    default: return `${v}`;
  }
}

/** The Settings row: what version this is, whether a newer one exists, and the button that fits. */
export function updatesRow() {
  if (!hasUpdater()) return null;
  const text = el("div", { class: "muted small" });
  const btn = el("button", { class: "btn btn-sm" });
  const render = (st) => {
    text.textContent = describe(st);
    if (st?.state === "ready") {
      btn.textContent = "Restart to update";
      btn.className = "btn btn-sm btn-primary";
      btn.disabled = false;
      btn.title = "Close Steam Deals, install the new version and open it again. Your basket and settings stay.";
      btn.onclick = () => api.updates.install();
    } else {
      btn.textContent = "Check for updates";
      btn.className = "btn btn-sm";
      btn.disabled = st?.state === "checking" || st?.state === "downloading" || st?.state === "unavailable";
      btn.title = "Look for a newer version on GitHub. A newer one downloads in the background.";
      btn.onclick = () => api.updates.check().then((r) => r?.ok && render(r.status));
    }
  };
  render(current);
  // Follow status changes while this Settings window is open; stop once it has closed.
  const live = (st) => (btn.isConnected ? render(st) : listeners.delete(live));
  listeners.add(live);
  return el("div", { class: "row row-toggle" },
    el("div", { class: "row-text" }, el("div", {}, "Updates"), text),
    btn);
}
