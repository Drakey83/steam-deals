// Website only: opening basket games one by one in Steam, and the Windows-app explanation with
// the pairing-code field (what lets a browser's basket reach the Steam cart).
import { APP_DOWNLOAD_URL, STEAM_CART_URL } from "../config.js";
import { el, imgEl } from "../lib/dom.js";
import { EV, emit } from "../lib/events.js";
import { fmtInt } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { Core, api, appPageUrl, isPhoneDevice, steamLink } from "../lib/platform.js";
import { gameImage, state } from "../state.js";
import { toast } from "../ui/toast.js";

/** What the Windows app adds, where to get it, and the pairing-code field. */
export function appPromo(t) {
  const phone = isPhoneDevice();
  const box = el("div", { class: "faster app-promo" },
    el("div", { class: "send-title", html: ICON.monitor }, el("span", {}, "Let your Windows PC do it for you")),
    el("div", { class: "muted" }, phone
      ? "The free Steam Deals Windows app is the bridge between this phone and Steam. Pair once, and this basket becomes your Steam cart, live: add or remove games here and they appear in or leave the cart within seconds, then pay in the Steam app or on the PC."
      : "The free Steam Deals Windows app is the bridge between this browser and Steam. Pair once, and this basket becomes your Steam cart, live: add or remove games here and they appear in or leave the cart within seconds."),
    el("ul", { class: "promo-list muted" },
      el("li", {}, "No send button and no codes to copy each time: it just stays in sync."),
      el("li", {}, "Works from anywhere, mobile data included. The PC only needs to be on, with the app in its tray."),
      el("li", {}, "Never buys anything. Checkout always happens in Steam."),
      el("li", {}, "Signed in through Steam here and in the app? They connect by themselves: no code needed."),
      el("li", {}, "Not signed in? Pair with a code instead. It shares only a random key and game ids."),
    ),
    el("div", { class: "btn-row" },
      phone
        ? el("a", { class: "btn btn-sm btn-primary", href: appPageUrl(), target: "_blank", rel: "noopener", html: `${ICON.monitor}<span>Get the Windows app</span>` })
        : el("a", { class: "btn btn-sm btn-primary", href: APP_DOWNLOAD_URL, html: `${ICON.download}<span>Download for Windows</span>` }),
      el("a", { class: "btn btn-sm", href: appPageUrl(), target: "_blank", rel: "noopener", html: `${ICON.external}<span>How it works</span>` }),
    ),
    el("div", { class: "muted small" }, phone ? "Install it on your PC (Windows 10 or 11, about 110 MB); the page explains everything." : "Windows 10 or 11, about 110 MB, free and open source."),
    pairCodeField(),
  );
  if (api.device === "windows" && t.items.length) {
    box.append(el("div", { class: "muted small" }, "Installed on this PC? ",
      el("a", { class: "link", href: "#", onclick: (e) => { e.preventDefault(); location.href = api.cart.appLink(t.items); } }, "Open this basket in the app"), "."));
  }
  return box;
}

function pairCodeField() {
  const codeInput = el("input", { class: "input code-input", type: "text", maxlength: 7, placeholder: "ABC123", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": "Pairing code" });
  const pairBtn = el("button", { class: "btn btn-primary btn-sm" }, "Pair");
  const pairNow = async () => {
    const code = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) return toast("A pairing code is 6 letters and numbers.", { type: "err" });
    pairBtn.disabled = true;
    const r = await api.pair.claim(code);
    pairBtn.disabled = false;
    if (!r.ok) return toast(r.error.message, { type: "err", timeout: 7000 });
    toast("Paired. This basket now syncs with your PC.", { type: "ok" });
    const s = await api.sync?.status();
    if (s?.ok) state.sync = s;
    emit(EV.basketOpen);
  };
  pairBtn.addEventListener("click", pairNow);
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pairNow();
  });
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase();
  });
  return el("div", { class: "pair-have" },
    el("div", { class: "muted small" }, el("b", {}, "Already have it?"), " In the app on your PC, open the basket and press “Pair a phone or browser”, then type the code it shows:"),
    el("div", { class: "btn-row" }, codeInput, pairBtn),
  );
}

/** Only this browser forgets the pairing; the PC and other devices keep theirs. */
export async function unpairHere() {
  await api.pair.unpair();
  state.sync = { paired: false, status: {} };
  toast("Unpaired. Your basket stays in this browser.", { type: "ok" });
  emit(EV.basketOpen);
}

/** One "Open in Steam" button per basket game, with progress, then "Open my Steam cart". */
export function perGameList(t) {
  const phone = isPhoneDevice();
  const inSteam = (appid) => (phone ? `https://store.steampowered.com/app/${appid}/` : `steam://store/${appid}`);
  const opened = state.openedInSteam;
  const progress = el("div", { class: "muted small" });
  const renderProgress = () => {
    const n = t.items.filter((b) => opened.has(b.appid)).length;
    progress.textContent = n ? `${fmtInt(n)} of ${fmtInt(t.items.length)} opened in Steam` : "";
  };
  const rows = t.items.map((b) => {
    const done = opened.has(b.appid);
    const btn = el("button", { class: "btn btn-sm", html: `${done ? ICON.check : ICON.play}<span>${done ? "Opened" : "Open in Steam"}</span>` });
    const row = el("div", { class: `steam-row ${done ? "done" : ""}` },
      imgEl(gameImage(b.appid, b.image), "basket-thumb small", Core.headerImage(b.appid)),
      el("div", { class: "basket-info" }, el("div", { class: "basket-name" }, b.name), el("div", { class: "muted small num" }, b.price ?? "")),
      btn);
    btn.addEventListener("click", () => {
      api.openExternal(inSteam(b.appid));
      opened.add(b.appid);
      row.classList.add("done");
      btn.innerHTML = `${ICON.check}<span>Opened</span>`;
      renderProgress();
    });
    return row;
  });
  renderProgress();
  return el("div", { class: "per-game" },
    el("div", { class: "muted small" }, "Each button opens the game in Steam with its Add to Cart button ready. Then open your cart to pay."),
    el("div", { class: "steam-list" }, rows),
    progress,
    el("div", { class: "btn-row" },
      el("button", { class: "btn btn-sm", html: `${ICON.basket}<span>Open my Steam cart</span>`, onclick: () => api.openExternal(steamLink(STEAM_CART_URL)) }),
      phone ? null : el("button", { class: "btn btn-sm", html: `${ICON.external}<span>Cart in browser</span>`, onclick: () => api.openExternal(STEAM_CART_URL) }),
    ),
  );
}
