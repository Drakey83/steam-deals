// Desktop only: pairing phones and browsers with this app's basket.
import { el } from "../lib/dom.js";
import { EV, emit } from "../lib/events.js";
import { ICON } from "../lib/icons.js";
import { api } from "../lib/platform.js";
import { state } from "../state.js";
import { closeDrawer, closeModal, modalHead, showModal } from "../ui/overlays.js";
import { toast } from "../ui/toast.js";

const CODE_LIFETIME_MS = 10 * 60 * 1000;
const POLL_MS = 3000;

/** The pairing section at the bottom of the basket. */
export function pairRow() {
  const host = el("div", { class: "import-row", id: "pair-row" });
  const render = (st) => {
    if (!st.paired) {
      host.replaceChildren(
        el("div", {}, el("b", {}, "Shop on your phone, pay anywhere."), " Pair a phone or any browser with this app and you share one basket: whatever you add there lands in your Steam cart within seconds, as long as this PC is on."),
        el("div", { class: "btn-row" }, el("button", { class: "btn btn-sm btn-primary", html: `${ICON.phone}<span>Pair a phone or browser</span>`, onclick: openPairDialog })),
      );
      return;
    }
    if (st.viaAccount) {
      host.replaceChildren(
        el("div", {}, el("b", {}, "Synced through your Steam account."), ` Every phone, browser and PC signed in through Steam as ${state.account?.name || "you"} shares this basket, your price alerts and Your taste, and this app keeps your Steam cart matching it${state.settings.closeToTray !== false ? ", even from the tray" : ""}.`),
        el("div", { class: "btn-row" },
          el("button", { class: "btn btn-sm", title: "For a phone or browser that isn't signed in through Steam", html: `${ICON.phone}<span>Add a device without signing in</span>`, onclick: openPairDialog })),
        el("div", { class: "muted small" }, "Nothing to set up on your other devices: sign in through Steam on steamdeal.vercel.app and they join automatically."),
      );
      return;
    }
    host.replaceChildren(
      el("div", {}, el("b", {}, "Paired."), ` This basket is shared with your phone and any browser you paired, and this app keeps your Steam cart matching it${state.settings.closeToTray !== false ? ", even from the tray" : ""}.`),
      el("div", { class: "btn-row" },
        el("button", { class: "btn btn-sm", html: `${ICON.phone}<span>Pair another device</span>`, onclick: openPairDialog }),
        el("button", { class: "btn btn-sm btn-ghost", onclick: unpairAll }, "Unpair all devices"),
      ),
      el("div", { class: "muted small" }, "Closing the window keeps Steam Deals syncing from the tray. Settings has “Start with Windows” so the PC is always ready."),
    );
  };
  render(state.sync || {});
  api.pair.status().then((r) => {
    if (!r.ok) return;
    state.sync = { ...(state.sync || {}), ...(r.sync || {}), paired: r.paired, viaAccount: Boolean(r.viaAccount), status: r.sync?.cart?.status || state.sync?.status || {}, subtotal: r.sync?.cart?.subtotal ?? state.sync?.subtotal ?? null };
    render(state.sync);
  });
  return host;
}

async function unpairAll() {
  await api.pair.unpair();
  state.sync = { ...(state.sync || {}), paired: false };
  toast("Unpaired. Your basket stays here.", { type: "ok" });
  emit(EV.basketOpen);
}

/** Shows a six-letter code and waits (up to ten minutes) for a phone or browser to type it in. */
export function openPairDialog() {
  closeDrawer();
  let cancelled = false;
  let timer = null;
  const close = () => {
    cancelled = true;
    clearTimeout(timer);
    closeModal();
  };
  const body = el("div", { class: "connect-body" });
  const status = el("div", { class: "muted connect-status", "aria-live": "polite" }, "Getting a pairing code…");
  showModal([
    modalHead("Pair a phone or browser", close, ICON.close),
    el("div", { class: "modal-body" }, body, status,
      el("div", { class: "muted small" }, "Pairing shares a random key between this app and the other device, and the basket itself: game ids, names and prices. No account details. You can unpair from the basket at any time.")),
  ], { onScrim: close });

  const start = async () => {
    body.replaceChildren();
    const r = await api.pair.start();
    if (cancelled) return;
    if (!r.ok) {
      status.textContent = r.error.message;
      body.append(el("button", { class: "btn", onclick: start }, "Try again"));
      return;
    }
    body.append(
      el("div", { class: "code-row" }, el("span", { class: "code num" }, r.code)),
      el("ol", { class: "steps" },
        el("li", {}, "On your phone or in any browser, open ", el("b", {}, "steamdeal.vercel.app"), " and open the basket (the + on any game puts something in it)."),
        el("li", {}, "Under “Already have it?”, type this code."),
      ),
      el("div", { class: "muted small" }, "After that the basket is shared: add or remove games on either side and this app keeps your Steam cart matching, as long as this PC is on. Turn on “Start with Windows” in Settings so it always is."),
    );
    status.textContent = "Waiting for the other device… (code lasts 10 minutes)";
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      const c = await api.pair.check(r.pairId);
      if (cancelled) return;
      if (c.ok && c.claimed) {
        status.textContent = "Paired!";
        toast("Paired. The basket is now shared.", { type: "ok" });
        api.pair.status().then((st) => {
          if (st.ok) state.sync = { ...(state.sync || {}), ...(st.sync || {}), paired: true };
        });
        setTimeout(() => {
          close();
          emit(EV.basketOpen);
        }, 800);
        return;
      }
      if ((c.ok && c.expired) || Date.now() - started > CODE_LIFETIME_MS) {
        status.textContent = "That code expired.";
        body.replaceChildren(el("button", { class: "btn btn-primary", onclick: start }, "Get a new code"));
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
  };
  start();
}
