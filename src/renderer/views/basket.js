// The basket: the + buttons, the top-bar button, and the basket panel with totals and tax.
// What happens with the Steam cart is in cart.js (and pairing.js / web-cart.js).
import { $, el } from "../lib/dom.js";
import { EV, emit, on } from "../lib/events.js";
import { fmtCents, fmtInt, plural } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { Core, api, isWeb } from "../lib/platform.js";
import { basketTotals, toggleInList } from "../logic/basket.js";
import { learn } from "../learning.js";
import { basket, inBasket, patchSettings, state } from "../state.js";
import { closeDrawer, closeModal, isBasketOpen, showDrawer } from "../ui/overlays.js";
import { toast } from "../ui/toast.js";
import { cartBadge, sendPanel } from "./cart.js";
import { pairRow } from "./pairing.js";
import { appPromo } from "./web-cart.js";
import { richTip } from "../ui/tooltip.js";

/** Replace the basket's contents (saved right away) and let every view catch up. */
export function setBasket(list) {
  patchSettings({ basket: list }, { persistNow: true });
  state.lastSent = null;
  emit(EV.basketChanged);
}

export function toggleBasket(d) {
  const { list, added } = toggleInList(basket(), d);
  if (added) {
    learn("basket", d);
    if (!d.packageid) toast("Steam doesn't sell this one as a single package, so it can't go in the cart. Open it on Steam instead.", { type: "err", timeout: 6000 });
    toast(`Added to basket · ${plural(list.length, "game")}`, { type: "ok", timeout: 2500 });
  }
  setBasket(list);
}

/** Wire the basket's reactions to changes made anywhere (cards, the panel, a paired phone). */
export function initBasket() {
  on(EV.basketChanged, () => {
    renderBasketButton();
    refreshBasketToggles();
    if (isBasketOpen()) openBasket();
  });
  on(EV.basketOpen, openBasket);
}

// Preselect the tax region from the person's location (country + state/province from the connection).
// Runs once per session; a region the person chose by hand is never overwritten.
let geoChecked = false;
export async function ensureTaxRegion() {
  if (geoChecked || !api.geo) return;
  geoChecked = true;
  const s = state.settings;
  if (s.taxRegion != null && !s.taxRegionAuto) return;
  const r = await api.geo.detect().catch(() => null);
  if (!r?.ok || !r.taxRegion || r.taxRegion === s.taxRegion) return;
  patchSettings({ taxRegion: r.taxRegion, taxRegionAuto: true }, { persistNow: true });
  renderBasketButton(); // its price includes the estimated tax
  if (isBasketOpen()) openBasket();
}

const totals = () => basketTotals(basket(), state.settings, Core);

/** The add/remove control on cards (icon) and in the details panel (with a label). */
export function basketToggle(d, { label = false } = {}) {
  const b = el("button", { class: `btn btn-sm basket-toggle ${label ? "" : "btn-icon"}`, dataset: { appid: d.appid } });
  paintToggle(b, d.name, label);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleBasket(d);
  });
  return b;
}

function paintToggle(b, name, label) {
  const isIn = inBasket(Number(b.dataset.appid));
  b.classList.toggle("on", isIn);
  b.setAttribute("aria-pressed", isIn);
  b.title = isIn ? "In your basket. Click to take it out." : "Add to basket: collect games here, then send them all to your Steam cart at once.";
  if (name) b.setAttribute("aria-label", isIn ? `Remove ${name} from basket` : `Add ${name} to basket`);
  b.innerHTML = (isIn ? ICON.check : ICON.plus) + (label ? `<span>${isIn ? "In basket" : "Add to basket"}</span>` : "");
}

function refreshBasketToggles() {
  for (const b of document.querySelectorAll(".basket-toggle")) paintToggle(b, null, Boolean(b.querySelector("span")));
}

export function basketButton() {
  return richTip(el("button", { class: "btn basket-btn", id: "basket-btn", "aria-label": "Basket", onclick: openBasket }), basketBreakdown);
}

/** The hover card on the basket button: what the price on it is made of. */
function basketBreakdown() {
  const t = totals();
  if (!t.items.length) return el("div", { class: "tip-note" }, "Your basket is empty. Add games with + on any card.");
  const money = (c) => fmtCents(c, t.sample);
  const row = (label, value, cls = "") => el("div", { class: `tip-row ${cls}` }, el("span", {}, label), el("span", { class: "num" }, value));
  const regionName = Core.TAX_REGIONS.find((r) => r.code === t.region)?.name;
  const rows = [
    el("div", { class: "tip-title" }, "Basket total"),
    row(plural(t.items.length, "game"), money(t.subtotal)),
    t.savings ? row("You save", money(t.savings), "savings") : null,
  ];
  if (t.region == null) {
    rows.push(row("Estimated tax", "—", "muted"), row("Total before tax", money(t.total), "total"),
      el("div", { class: "tip-note" }, "Open the basket and pick your region to include an estimate."));
  } else if (t.region === "included") {
    rows.push(row("Tax", "included", "muted"), row("Total", money(t.total), "total"),
      el("div", { class: "tip-note" }, "Steam prices in your region already include tax."));
  } else {
    rows.push(row(`Estimated tax · ${regionName ? `${regionName} ` : ""}${t.rate}%`, money(t.taxCents)), row("Estimated total", money(t.total), "total"),
      el("div", { class: "tip-note" }, "An estimate. Steam's checkout shows the exact tax."));
  }
  return rows;
}

export function renderBasketButton() {
  const b = $("#basket-btn");
  if (!b) return;
  const t = totals();
  b.innerHTML = ICON.basket;
  b.classList.toggle("has-items", t.items.length > 0);
  if (!t.items.length) {
    b.append(el("span", { class: "basket-label" }, "Basket"));
    b.setAttribute("aria-label", "Basket, empty");
    return;
  }
  // The price shown is what checkout should come to: the games plus the estimated tax for the person's region.
  const money = (c) => fmtCents(c, t.sample);
  b.append(el("span", { class: "basket-count num" }, fmtInt(t.items.length)), el("span", { class: "basket-total num" }, money(t.total)));
  // The hover card (basketBreakdown) shows how it's made up; screen readers get the same in the label.
  b.setAttribute("aria-label", `Basket, ${plural(t.items.length, "game")}, ${t.region == null || t.region === "included" ? "" : "estimated "}total ${money(t.total)}`);
}

// ----- the basket panel (lives in the drawer) -----
export function openBasket() {
  closeModal();
  renderBasketButton(); // the tax region or rate may just have changed
  const t = totals();
  const empty = !t.items.length;
  const actions = empty
    ? isWeb && !api.pair?.isPaired() ? el("div", { class: "send-box" }, appPromo(t)) : null
    : sendPanel(t);
  showDrawer([
    el("div", { class: "basket-head" },
      el("div", { class: "fy-title", html: ICON.basket }, el("span", {}, "Your basket")),
      el("div", { class: "spacer" }),
      empty ? null : el("button", { class: "btn btn-ghost btn-sm", html: `${ICON.trash}<span>Clear</span>`, onclick: () => setBasket([]) }),
      el("button", { class: "btn btn-icon btn-ghost", "aria-label": "Close", html: ICON.close, onclick: closeDrawer }),
    ),
    el("div", { class: "drawer-body basket-body" },
      empty
        ? el("div", { class: "empty basket-empty" }, el("div", { class: "glyph", html: ICON.basket }), el("h3", {}, "Your basket is empty"),
            el("p", {}, "Use the + on any game to collect sales here and see what they add up to before you check out on Steam."))
        : el("div", { class: "basket-list" }, t.items.map(basketRow)),
      empty ? null : summary(t),
      actions,
      api.cart?.mode === "direct" && api.pair?.start ? pairRow() : null,
    ),
  ], { kind: "basket" });
}

function basketRow(b) {
  const badgeHost = el("div", { class: "basket-sync", dataset: { cartBadge: b.appid } }, cartBadge(b.appid));
  return el("div", { class: "basket-row" },
    el("img", { class: "basket-thumb", src: Core.headerImage(b.appid), alt: "", loading: "lazy" }),
    el("div", { class: "basket-info" },
      el("div", { class: "basket-name" }, b.name),
      el("div", { class: "basket-price-row" },
        b.discount > 0 ? el("span", { class: "badge-discount num basket-badge" }, `-${b.discount}%`) : null,
        el("span", { class: "price num" }, b.price ?? "—"),
        b.discount > 0 && b.originalCents ? el("span", { class: "price-orig num" }, fmtCents(b.originalCents, b.price)) : null,
        el("a", { class: "link basket-open-link", href: "#", onclick: (e) => { e.preventDefault(); api.openExternal(Core.storeUrl(b.appid)); } }, "Steam page"),
      ),
      badgeHost,
    ),
    el("button", { class: "btn btn-icon btn-ghost", title: "Remove", "aria-label": `Remove ${b.name}`, html: ICON.close, onclick: () => setBasket(basket().filter((x) => x.appid !== b.appid)) }),
  );
}

/** Subtotal, savings, the tax region picker, and the estimated total. */
function summary(t) {
  const s = state.settings;
  const needsRegion = t.region == null;
  if (needsRegion) ensureTaxRegion();
  const regionName = Core.TAX_REGIONS.find((r) => r.code === t.region)?.name;
  const note = t.region === "included"
    ? `Steam prices ${s.taxRegionAuto ? "where you are" : "in your region"} already include tax, so this total should match checkout.`
    : needsRegion ? "Steam adds sales tax at checkout based on your billing address. Pick your region above for an estimate."
    : `${s.taxRegionAuto && regionName ? `Looks like you're in ${regionName}. ` : ""}Estimate only: local taxes and digital-goods rules vary. Steam's checkout shows the exact amount before you pay.`;
  return el("div", { class: "basket-summary" },
    el("div", { class: "sum-row" }, el("span", {}, `Subtotal · ${plural(t.items.length, "game")}`), el("span", { class: "num" }, fmtCents(t.subtotal, t.sample))),
    t.savings ? el("div", { class: "sum-row muted" }, el("span", {}, "You save"), el("span", { class: "num savings" }, fmtCents(t.savings, t.sample))) : null,
    el("div", { class: "sum-row tax-row" },
      el("div", { class: "tax-pick" },
        el("span", {}, t.region === "included" ? "Tax" : "Estimated tax",
          s.taxRegionAuto && !needsRegion ? el("span", { class: "chip chip-sm auto-chip", title: "Picked from your location. Change it if Steam bills you somewhere else." }, "auto") : null),
        regionSelect(t, needsRegion),
        t.region === "custom" ? customRateInput() : null),
      el("span", { class: "num" }, t.region === "included" ? "included" : needsRegion ? "—" : fmtCents(t.taxCents, t.sample)),
    ),
    el("div", { class: "sum-row total" }, el("span", {}, needsRegion ? "Total before tax" : "Estimated total"), el("span", { class: "num" }, fmtCents(t.total, t.sample))),
    el("div", { class: "muted tax-note" }, note),
  );
}

function regionSelect(t, needsRegion) {
  const sel = el("select", { class: "select", id: "tax-region", "aria-label": "Tax region" },
    el("option", { value: "", disabled: true, selected: needsRegion }, state.settings.country === "CA" ? "Choose your province…" : "Choose your state…"));
  let group = null;
  for (const r of Core.TAX_REGIONS) {
    if (r.group && r.group !== group?.label) {
      group = el("optgroup", { label: r.group });
      sel.append(group);
    }
    const opt = el("option", { value: r.code, selected: t.region === r.code }, r.rate != null && r.group ? `${r.name} · ${r.rate}%` : r.name);
    (r.group ? group : sel).append(opt);
  }
  sel.addEventListener("change", () => {
    patchSettings({ taxRegion: sel.value, taxRegionAuto: false }, { persistNow: true });
    openBasket();
  });
  return sel;
}

function customRateInput() {
  const input = el("input", { class: "input num", type: "number", min: 0, max: 30, step: 0.001, value: state.settings.taxCustomRate || "", placeholder: "%", style: { width: "90px" }, "aria-label": "Custom tax rate" });
  input.addEventListener("change", () => {
    patchSettings({ taxCustomRate: Number(input.value) || 0 }, { persistNow: true });
    openBasket();
  });
  return input;
}
