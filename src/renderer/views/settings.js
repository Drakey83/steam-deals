// The Settings dialog: store region and language, scan depth, score weights, For-you mix, account,
// the Windows app's background options, and About.
import { COUNTRIES, LANGUAGES, SCAN_DEPTHS } from "../config.js";
import { $, el } from "../lib/dom.js";
import { ICON } from "../lib/icons.js";
import { api, isWeb } from "../lib/platform.js";
import { normWeights } from "../logic/ranking.js";
import { patchSettings, state } from "../state.js";
import { avatarEl } from "../ui/common.js";
import { closeDrawer, modalHead, showModal } from "../ui/overlays.js";
import { signInFromBrowse, signOut } from "./account.js";
import { renderStats } from "./feed.js";
import { renderSidebar } from "./sidebar.js";

const NOTE = { fontSize: "12.5px" };

export function openSettings() {
  closeDrawer();
  const s = state.settings;
  const refetch = (patch) => patchSettings(patch, { refetch: true, persistNow: true });
  const select = (key, options, onChange) => {
    const sel = el("select", { class: "select" }, options.map(([v, l]) => el("option", { value: v, selected: String(s[key]) === String(v) }, l)));
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  };
  const row = (label, control) => el("div", { class: "row" }, el("span", {}, label), control);
  const group = (title, ...children) => el("div", { class: "settings-group" }, el("h3", {}, title), ...children);

  const body = el("div", { class: "modal-body" },
    group("Store",
      row("Region (prices and currency)", select("country", COUNTRIES, (v) => refetch({ country: v }))),
      row("Language", select("language", LANGUAGES, (v) => refetch({ language: v }))),
      row("Scan depth", select("scanDepth", SCAN_DEPTHS, (v) => { refetch({ scanDepth: Number(v) }); renderSidebar(); })),
    ),
    group("Score weights", weightSliders(s), el("div", { class: "muted", style: NOTE }, "Popularity is the review count on a log scale: 1,000 reviews scores 50, a million or more scores 100. The scale is fixed, so a game's score doesn't change with what else is loaded.")),
    group("For you", tasteSlider(s), el("div", { class: "muted", style: NOTE }, "How much the For-you ranking favours games that match your library over games that are simply the best bargains. 100% is pure taste match; 0% is the plain deal score.")),
    group("Account", accountRow()),
    isWeb
      ? group("Windows app", el("div", { class: "muted", style: { fontSize: "13px" } },
          "The free Steam Deals Windows app does everything this site does and adds the one thing a browser can't: it fills your Steam cart. Pair this browser with it (basket → “Already have it?”) and your basket becomes your Steam cart, live, from anywhere. ",
          el("a", { class: "link", href: "/app", target: "_blank", rel: "noopener" }, "How it works and download"), "."))
      : group("Windows app",
          toggleRow("Keep my Steam cart in sync with the basket", "pairAutoCart", true, "Adds what you put in the basket, here or on a paired phone, to your Steam cart and removes what you take out. It never buys anything."),
          toggleRow("Close to the tray instead of quitting", "closeToTray", true, "The X button hides Steam Deals next to the clock so syncing keeps running. Quit from the tray menu."),
          ...startupRows()),
    group("About", el("div", { class: "about", id: "about" }, isWeb
      ? "Steam Deals pulls discounts from Steam's public store API, hides what you own, and ranks what's left. Settings and any API key you add stay in this browser. No ads, no tracking. The user count is anonymous: one random id per browser, nothing tied to you or your Steam account. Not affiliated with Valve Corporation."
      : "Steam Deals pulls discounts straight from Steam's public store API, hides what you own, and ranks what's left. No accounts, no telemetry, no third parties. Not affiliated with Valve Corporation.")),
  );
  showModal([modalHead("Settings", undefined, ICON.close), body]);
  api.version().then((r) => {
    if (r.ok) $("#about")?.append(el("div", { style: { marginTop: "6px" } }, `Version ${r.value}`));
  });
}

/** Discount / rating / popularity sliders; the shown percentages always add up to 100. */
function weightSliders(s) {
  const weights = { ...s.weights };
  const labels = {};
  const slider = (key, label) => {
    labels[key] = el("span", { class: "val num" }, `${Math.round(normWeights(weights)[key] * 100)}%`);
    const input = el("input", { type: "range", min: 0, max: 100, step: 5, value: weights[key] });
    input.addEventListener("input", () => {
      weights[key] = Number(input.value);
      const n = normWeights(weights);
      for (const k of Object.keys(n)) labels[k].textContent = `${Math.round(n[k] * 100)}%`;
      patchSettings({ weights: { ...weights } });
      renderStats();
    });
    return el("div", { class: "weight" }, el("span", {}, label), input, labels[key]);
  };
  return el("div", { class: "weights" }, slider("discount", "Discount depth"), slider("rating", "Review rating"), slider("popularity", "Popularity"));
}

function tasteSlider(s) {
  const val = el("span", { class: "val num" }, `${s.personalWeight ?? 60}%`);
  const input = el("input", { type: "range", min: 0, max: 100, step: 5, value: s.personalWeight ?? 60 });
  input.addEventListener("input", () => {
    val.textContent = `${input.value}%`;
    patchSettings({ personalWeight: Number(input.value) });
  });
  return el("div", { class: "weights" }, el("div", { class: "weight" }, el("span", {}, "Taste over deal"), input, val));
}

function accountRow() {
  const a = state.account;
  if (!a || a.method === "guest") {
    return el("div", { class: "row" }, el("span", { class: "muted" }, "Not signed in. Owned games can't be hidden."), el("button", { class: "btn btn-sm", onclick: signInFromBrowse }, "Sign in through Steam"));
  }
  return el("div", { class: "row" },
    el("div", { style: { display: "flex", gap: "10px", alignItems: "center" } }, avatarEl(a),
      el("div", {}, el("div", { style: { fontWeight: 600 } }, a.name), el("div", { class: "muted", style: { fontSize: "12px" } }, a.method === "steam" ? "Signed in through Steam" : "Steam Web API key"))),
    el("button", { class: "btn btn-sm btn-danger", onclick: signOut }, "Sign out"));
}

/** "Start with Windows", and under it "Open closed to the tray", which only applies (and is only enabled) when it's on. */
function startupRows() {
  const start = toggleRow("Start with Windows", "startWithWindows", false, "Opens Steam Deals full screen (maximized) when you sign in to Windows, so your PC is always ready for your phone.");
  const minimized = toggleRow("Open closed to the tray", "startMinimized", false, "Instead of opening full screen, Steam Deals starts quietly in the tray next to the clock. Click the icon to open it.");
  const sync = () => {
    const on = start.querySelector("input").checked;
    minimized.classList.toggle("disabled", !on);
    minimized.querySelector("input").disabled = !on;
  };
  start.querySelector("input").addEventListener("change", sync);
  sync();
  return [start, minimized];
}

/** A setting with an explanation and a switch on the right. */
function toggleRow(label, key, def, help) {
  const input = el("input", { type: "checkbox", checked: state.settings[key] ?? def });
  input.addEventListener("change", () => {
    patchSettings({ [key]: input.checked }, { persistNow: true });
    if (key === "pairAutoCart" && input.checked) api.sync?.now();
  });
  return el("div", { class: "row row-toggle" },
    el("div", { class: "row-text" }, el("div", {}, label), help ? el("div", { class: "muted", style: NOTE }, help) : null),
    el("label", { class: "toggle" }, input, el("span", { class: "switch" })));
}
