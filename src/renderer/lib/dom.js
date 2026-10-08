// Tiny DOM helpers. Text passed as a child is always escaped; only constant SVG strings use `html`.

export const $ = (sel, root = document) => root.querySelector(sel);

/** Create an element. Attributes: class, style (object), dataset, on* handlers, html, booleans, strings. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Append children, skipping null/false (handy for conditional pieces). */
export const appendKids = (parent, ...kids) => parent.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));

/**
 * A lazy image that fades in when loaded. If it fails it tries `fallback` once, and only then hides itself (CSS can
 * tell by .loaded / .failed).
 */
export function imgEl(src, cls, fallback = null) {
  const img = el("img", { class: cls, alt: "", loading: "lazy", decoding: "async", src });
  img.addEventListener("load", () => img.classList.add("loaded"));
  img.addEventListener("error", () => {
    if (fallback && img.getAttribute("src") !== fallback) {
      img.src = fallback;
      return;
    }
    img.classList.add("failed");
    img.style.display = "none";
  });
  return img;
}
