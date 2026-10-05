// The side drawer (game details or the basket), the centered modal, the scrim behind them,
// and the small popup menu. Each view fills the panel; this module owns opening and closing.
import { $, el } from "../lib/dom.js";
import { EV, emit } from "../lib/events.js";
import { state } from "../state.js";

const drawer = () => $("#drawer");
const modal = () => $("#modal");
const scrim = () => $("#scrim");

export const isDrawerOpen = () => drawer().classList.contains("open");
export const isBasketOpen = () => drawer().classList.contains("basket-open");
export const isModalOpen = () => modal().classList.contains("open");

function showScrim(onClick) {
  scrim().classList.add("open");
  scrim().onclick = onClick;
}

/** Replace the drawer's content and slide it in. `kind` = "details" | "basket". */
export function showDrawer(children, { kind = "details" } = {}) {
  const d = drawer();
  d.innerHTML = "";
  d.classList.toggle("basket-open", kind === "basket");
  d.append(...children.filter(Boolean));
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  showScrim(closeAll);
  d.scrollTop = 0;
}

export function closeDrawer() {
  const d = drawer();
  d.classList.remove("open", "basket-open");
  d.setAttribute("aria-hidden", "true");
  if (!isModalOpen()) scrim().classList.remove("open");
  state.selected = null;
}

/** Replace the modal's content and show it. `onScrim` defaults to closing everything. */
export function showModal(children, { onScrim = closeAll } = {}) {
  const m = modal();
  m.innerHTML = "";
  m.append(...children.filter(Boolean));
  m.classList.add("open");
  m.setAttribute("aria-hidden", "false");
  showScrim(onScrim);
}

export function closeModal() {
  const m = modal();
  if (!m.classList.contains("open")) return;
  m.classList.remove("open");
  m.setAttribute("aria-hidden", "true");
  if (!isDrawerOpen()) scrim().classList.remove("open");
  emit(EV.modalClosed);
}

export function closeAll() {
  closeDrawer();
  closeModal();
}

/** A modal header with a title and a close button. */
export function modalHead(title, onClose = closeModal, closeIcon) {
  return el("div", { class: "modal-head" }, el("h2", {}, title), el("button", { class: "btn btn-icon btn-ghost", "aria-label": "Close", html: closeIcon, onclick: onClose }));
}

// ----- popup menu (account menu) -----
let menuEl = null;

/** Show a menu under `anchor`, right-aligned. Clicking anywhere closes it. */
export function openMenu(anchor, children) {
  closeMenu();
  const menu = el("div", { class: "menu", role: "menu" }, children);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 8}px`;
  menu.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
  menuEl = menu;
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

export function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

export const isMenuOpen = () => Boolean(menuEl);
