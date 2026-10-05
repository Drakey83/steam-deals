// Fixed option lists and defaults for the UI. Pure data.

export const COUNTRIES = [
  ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany (EUR)"], ["FR", "France (EUR)"], ["ES", "Spain (EUR)"],
  ["IT", "Italy (EUR)"], ["NL", "Netherlands (EUR)"], ["PL", "Poland"], ["SE", "Sweden"], ["NO", "Norway"], ["CH", "Switzerland"],
  ["CA", "Canada"], ["MX", "Mexico"], ["BR", "Brazil"], ["AR", "Argentina"], ["CL", "Chile"], ["AU", "Australia"], ["NZ", "New Zealand"],
  ["JP", "Japan"], ["KR", "South Korea"], ["CN", "China"], ["TW", "Taiwan"], ["HK", "Hong Kong"], ["SG", "Singapore"], ["IN", "India"],
  ["TR", "Türkiye"], ["UA", "Ukraine"], ["RU", "Russia"], ["ZA", "South Africa"], ["AE", "United Arab Emirates"], ["SA", "Saudi Arabia"], ["IL", "Israel"],
];

export const LANGUAGES = [
  ["english", "English"], ["german", "Deutsch"], ["french", "Français"], ["spanish", "Español"], ["brazilian", "Português (Brasil)"],
  ["russian", "Русский"], ["japanese", "日本語"], ["koreana", "한국어"], ["schinese", "简体中文"], ["tchinese", "繁體中文"],
  ["polish", "Polski"], ["italian", "Italiano"], ["turkish", "Türkçe"],
];

export const SORTS = [
  ["score", "Best score"], ["discount", "Biggest discount"], ["rating", "Highest rated"],
  ["reviews", "Most reviewed"], ["price", "Lowest price"], ["name", "Name A–Z"],
];

export const REVIEW_MINS = [[0, "Any"], [100, "100+"], [1000, "1,000+"], [10000, "10,000+"], [50000, "50,000+"]];

// 0 = everything on sale (~70k items, 2–3 min, streams in). Only offered in sale mode; the full catalog is ~240k.
export const SCAN_DEPTHS = [[3000, "Quick · 3,000"], [10000, "Standard · 10,000"], [25000, "Deep · 25,000"], [0, "Everything on sale · ~70,000 · slow"]];

/** Cards added to the grid per infinite-scroll step. */
export const PAGE = 60;

export const DEFAULT_FILTERS = Object.freeze({
  minDiscount: 50,
  minRating: 80,
  minReviews: 0,
  selectedTags: [],
  wishlistOnly: false,
  hideOwned: true,
  sort: "score",
  deckMachineOnly: false,
});

// Settings that don't change which games are shown or in what order. Changing them must not
// redraw the grid (which would also scroll it back to the top).
export const NON_RESULT_KEYS = new Set([
  "basket", "taxRegion", "taxCustomRate", "taxRegionAuto", "showTaste", "showTastePhone",
  "pairAutoCart", "syncPaused", "closeToTray", "startWithWindows", "startMinimized",
]);

export const STEAM_CART_URL = "https://store.steampowered.com/cart/";
export const APP_DOWNLOAD_URL = "https://github.com/Drakey83/steam-deals/releases/latest/download/Steam-Deals-Setup.exe";
