// A styled tooltip card for hover and keyboard focus. Unlike the browser's own title tooltips it can hold
// formatted content, and it is placed by the app: below its anchor (above if there's no room), slid sideways so
// it always stays inside the window, with a small arrow pointing at the anchor.
import { el } from "../lib/dom.js";

const GAP = 8; // between the anchor and the card
const EDGE = 8; // minimum distance from the window's edges
const SHOW_DELAY = 180;
let seq = 0;

/**
 * Attach a tooltip to `anchor`. `build()` returns the card's content (a node, an array of nodes, or null for
 * no tooltip) and is called each time it opens, so it always shows current figures.
 */
export function richTip(anchor, build) {
  const id = `tip-${++seq}`;
  let card = null;
  let timer = null;

  const place = () => {
    const a = anchor.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    const below = a.bottom + GAP + c.height <= innerHeight - EDGE || a.top - GAP - c.height < EDGE;
    const top = below ? a.bottom + GAP : a.top - GAP - c.height;
    const left = Math.min(Math.max(EDGE, a.left + a.width / 2 - c.width / 2), innerWidth - EDGE - c.width);
    card.style.top = `${Math.round(top)}px`;
    card.style.left = `${Math.round(left)}px`;
    card.classList.toggle("above", !below);
    // Keep the arrow on the anchor even when the card had to slide to stay on screen.
    const arrow = Math.min(Math.max(14, a.left + a.width / 2 - left), c.width - 14);
    card.style.setProperty("--arrow-x", `${Math.round(arrow)}px`);
  };

  const show = () => {
    clearTimeout(timer);
    const content = build();
    if (!content) return;
    hideNow();
    card = el("div", { class: "rich-tip", id, role: "tooltip" }, content);
    document.body.append(card);
    anchor.setAttribute("aria-describedby", id);
    place();
    requestAnimationFrame(() => card?.classList.add("open"));
  };
  const hideNow = () => {
    clearTimeout(timer);
    card?.remove();
    card = null;
    anchor.removeAttribute("aria-describedby");
  };
  const open = () => {
    clearTimeout(timer);
    timer = setTimeout(show, SHOW_DELAY);
  };

  anchor.addEventListener("mouseenter", open);
  anchor.addEventListener("focus", () => anchor.matches(":focus-visible") && open());
  anchor.addEventListener("mouseleave", hideNow);
  anchor.addEventListener("blur", hideNow);
  anchor.addEventListener("click", hideNow);
  anchor.addEventListener("keydown", (e) => e.key === "Escape" && hideNow());
  addEventListener("scroll", hideNow, { capture: true, passive: true });
  addEventListener("resize", hideNow, { passive: true });
  return anchor;
}
