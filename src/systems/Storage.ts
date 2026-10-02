/**
 * Persistence layer: a tiny typed wrapper over localStorage.
 *
 * Every call is guarded, because storage can be missing or throw (private
 * browsing, blocked site data, quota). Callers always get a value back.
 */
const PREFIX = 'waves-of-rage.';

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
