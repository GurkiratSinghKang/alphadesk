/**
 * Safe localStorage wrappers.
 * ───────────────────────────
 * Safari Private Browsing, iOS quota-exceeded, and any storage error cause
 * native localStorage calls to throw. This wrapper swallows the error and
 * logs it so the calling UI code doesn't crash the tree.
 *
 * Prefer these over the bare `window.localStorage.*` calls in any component
 * that runs on iOS or could be reached in Safari Private Mode.
 */
export function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    console.warn("localStorage.setItem failed (Safari Private Mode?):", key, e);
  }
}

export function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
