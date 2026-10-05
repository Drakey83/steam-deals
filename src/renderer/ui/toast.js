// Short messages in the corner, optionally with one action button.
import { $, el } from "../lib/dom.js";

export function toast(message, { type = "", action, actionLabel = "Retry", timeout = 5000 } = {}) {
  const host = $("#toasts");
  if (!host) return;
  const node = el("div", { class: `toast ${type}`, role: "status" }, el("span", {}, message));
  if (action) {
    node.append(
      el("button", {
        class: "btn btn-sm",
        onclick: () => {
          node.remove();
          action();
        },
      }, actionLabel),
    );
  }
  host.append(node);
  setTimeout(() => node.remove(), timeout);
}
