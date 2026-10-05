// What the page runs in. The desktop app's preload and the website's web-api.js both provide
// window.steamDeals with the same shape; src/shared/core.js provides window.SteamCore.

export const api = window.steamDeals;
export const Core = window.SteamCore;

export const isWeb = api.platform === "web";
export const isPhoneDevice = () => api.device === "ios" || api.device === "android";

/** The "how the Windows app works" page: relative on the website, absolute inside the app. */
export const appPageUrl = () => (isWeb ? "/app" : "https://steamdeal.vercel.app/app");

/** Phones open Steam pages on the web (which hands off to the Steam app); desktops use the steam:// client links. */
export const steamLink = (url) => (isPhoneDevice() ? url : `steam://openurl/${url}`);

// Narrow screens (tablets in portrait, phones, short landscape phones) move the view toggles into the scrolling
// content. PHONE is the subset where the taste panel starts collapsed. Must match the breakpoints in the CSS.
export const NARROW = window.matchMedia("(max-width: 860px), (max-height: 500px)");
export const PHONE = window.matchMedia("(max-width: 640px), (max-height: 500px)");
