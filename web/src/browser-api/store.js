// localStorage with JSON values. Never throws: in a private window or with storage blocked,
// reads come back empty and writes are skipped (settings then just don't persist).
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* full or blocked */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* blocked */
    }
  },
};
