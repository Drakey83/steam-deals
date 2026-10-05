// Number, date and money formatting. Pure functions (unit-tested).

export const fmtInt = (n) => Number(n || 0).toLocaleString("en-US");

export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A span of time in words: "a minute", "12 minutes", "3 hours", "2 days". */
export function durationText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 2) return "a minute";
  if (m < 60) return `${m} minutes`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.round(h / 24)} days`;
}

/** Format cents like Steam does for this region, reusing the currency symbol from a real price string. */
export function fmtCents(cents, sample) {
  const m = String(sample || "$0.00").match(/^([^\d\s]*)\s?[\d.,]+\s?([^\d\s]*)$/);
  const [pre, post] = m ? [m[1], m[2]] : ["$", ""];
  const n = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${pre}${n}${post}`;
}

/** "1 game" / "3 games". */
export const plural = (n, word) => `${fmtInt(n)} ${word}${n === 1 ? "" : "s"}`;
