// One tooltip system for the whole interface (desktop app and website), so every hint looks and behaves the same.
//
// Any element with a `title` (or `data-tip`) gets a styled card instead of the browser's plain tooltip, which
// can't be styled and can run off the side of the window. Elements registered with richTip() show formatted
// content built fresh each time. The card is placed below its element (above if there's no room), slid
// sideways to stay inside the window, with an arrow pointing at the element.
//
// How it opens:
//   mouse / pen   hover (short delay)
//   keyboard      focus (only keyboard focus, not clicks)
//   touch         press and hold (the press then doesn't also click), or tap a "?" help icon
// It closes when the pointer leaves, on a tap elsewhere, on scroll or resize, or with Escape.
import { el } from "../lib/dom.js";

const GAP = 8; // between the element and the card
const EDGE = 8; // minimum distance from the window's edges
const HOVER_DELAY = 350;
const HELP_HOVER_DELAY = 120; // "?" icons exist to explain, so they open quickly
const HOLD_MS = 450; // touch: how long a press must last to show the tip
const MOVE_SLOP = 10; // touch: moving further than this is a scroll, not a hold
const SELECTOR = "[data-tip], [title], .help-tip";

const builders = new WeakMap(); // element → () => content, for richTip
let card = null;
let owner = null; // the element whose tip is showing
let timer = null;
let pending = null; // the element whose tip is about to open
let pinned = false; // opened by touch or a "?" tap: stays until dismissed
let swallowClick = false;
let seq = 0;

/** Attach formatted content to `anchor`; `build()` returns nodes (or null for no tip) each time it opens. */
export function richTip(anchor, build) {
  builders.set(anchor, build);
  anchor.dataset.tip ??= "";
  return anchor;
}

/** Move a native title into data-tip so the browser doesn't show its own tooltip as well. */
function adopt(node) {
  const t = node.getAttribute("title");
  if (t) {
    node.dataset.tip = t;
    node.removeAttribute("title");
    if (!node.hasAttribute("aria-label") && !node.textContent.trim()) node.setAttribute("aria-label", t);
    else if (!node.getAttribute("aria-description")) node.setAttribute("aria-description", t);
  }
  return node;
}

const tipTarget = (from) => {
  const node = from?.closest?.(SELECTOR);
  return node && !node.closest(".rich-tip") ? adopt(node) : null;
};

function content(node) {
  const build = builders.get(node);
  if (build) return build();
  const text = node.dataset.tip;
  return text ? el("div", { class: "tip-text" }, text) : null;
}

function place() {
  if (!card || !owner?.isConnected) return hide();
  const a = owner.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const below = a.bottom + GAP + c.height <= innerHeight - EDGE || a.top - GAP - c.height < EDGE;
  const top = below ? a.bottom + GAP : a.top - GAP - c.height;
  const left = Math.min(Math.max(EDGE, a.left + a.width / 2 - c.width / 2), innerWidth - EDGE - c.width);
  card.style.top = `${Math.round(Math.max(EDGE, top))}px`;
  card.style.left = `${Math.round(left)}px`;
  card.classList.toggle("above", !below);
  const arrow = Math.min(Math.max(14, a.left + a.width / 2 - left), c.width - 14); // stays on the element
  card.style.setProperty("--arrow-x", `${Math.round(arrow)}px`);
}

function show(node, { pin = false } = {}) {
  clearTimeout(timer);
  const body = content(node);
  hide();
  if (!body) return;
  owner = node;
  pinned = pin;
  const id = `tip-${++seq}`;
  card = el("div", { class: `rich-tip ${pin ? "pinned" : ""}`, id, role: "tooltip" }, body);
  document.body.append(card);
  node.setAttribute("aria-describedby", id);
  place();
  requestAnimationFrame(() => card?.classList.add("open"));
}

export function hide() {
  clearTimeout(timer);
  pending = null;
  owner?.removeAttribute("aria-describedby");
  card?.remove();
  card = null;
  owner = null;
  pinned = false;
}

function later(node, ms, opts) {
  if (pending === node) return; // already on its way (the pointer just moved onto a child)
  clearTimeout(timer);
  pending = node;
  timer = setTimeout(() => {
    pending = null;
    show(node, opts);
  }, ms);
}

/** Start the tooltip system. Call once. */
export function initTooltips() {
  // Mouse and pen: hover.
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const node = tipTarget(e.target);
    if (!node || node === owner) return;
    if (pinned) return;
    later(node, node.classList.contains("help-tip") ? HELP_HOVER_DELAY : HOVER_DELAY);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch" || pinned) return;
    const node = tipTarget(e.target);
    if (!node || node.contains(e.relatedTarget)) return;
    if (node === owner || node === pending || !card) hide();
  });

  // Keyboard: focus.
  document.addEventListener("focusin", (e) => {
    const node = tipTarget(e.target);
    if (node && e.target.matches(":focus-visible")) later(node, 150);
  });
  document.addEventListener("focusout", (e) => {
    if (!pinned && owner && owner.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && card) hide();
  });

  // Touch: press and hold shows the tip; the click that would follow the hold is swallowed.
  let hold = null;
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") {
      // Pressing means the person knows what they're doing; don't cover a slider being dragged. ("?" icons
      // handle their own clicks, so a second click closes their card.)
      if (!e.target.closest?.(".help-tip")) hide();
      return;
    }
    if (card && !owner?.contains(e.target)) hide();
    const node = tipTarget(e.target);
    if (!node || node.classList.contains("help-tip")) return;
    hold = { node, x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      swallowClick = true;
      show(node, { pin: true });
      navigator.vibrate?.(10);
    }, HOLD_MS);
  }, { passive: true });
  const cancelHold = () => {
    if (hold && !pinned) clearTimeout(timer);
    hold = null;
  };
  document.addEventListener("pointermove", (e) => {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > MOVE_SLOP) cancelHold();
  }, { passive: true });
  document.addEventListener("pointerup", cancelHold, { passive: true });
  document.addEventListener("pointercancel", cancelHold, { passive: true });
  document.addEventListener("click", (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // "?" icons: a tap or click toggles their explanation (the way to read them on a phone).
    const help = e.target.closest?.(".help-tip");
    if (help) {
      e.preventDefault();
      e.stopPropagation();
      if (owner === tipTarget(help) && pinned) hide();
      else show(tipTarget(help), { pin: true });
    }
  }, true);
  // A long press on a phone would otherwise open the system menu (copy, share…) over the tip.
  document.addEventListener("contextmenu", (e) => {
    if (pinned || (hold && tipTarget(e.target))) e.preventDefault();
  });

  addEventListener("scroll", () => card && hide(), { capture: true, passive: true });
  addEventListener("resize", () => card && hide(), { passive: true });
}
