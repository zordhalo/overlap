/**
 * Circles this browser has seen, remembered locally.
 *
 * A circle slug is a capability URL: holding the link is the entire
 * authorisation, which is what lets Overlap work without accounts. The cost of
 * that model is brutal if it is left unaddressed — lose the link and the circle
 * is unreachable forever. There is deliberately no query that lists circles, no
 * email on file, and the member cookie is scoped to `/c/<slug>`, so it cannot
 * help you anywhere else. Backing out of creation orphans an empty circle that
 * nobody can ever reach again.
 *
 * The fix has to stay client-side. A server-side "my circles" index would mean
 * building the very lookup surface the security model depends on not existing.
 * This only ever stores links the browser already had — the same information
 * already sitting in its history — so it widens nothing, and it is forgettable
 * on demand for shared machines.
 *
 * Scope is honest and must be described that way in the UI: this browser only.
 * A different device or a cleared profile still cannot recover a lost link.
 */

const KEY = 'overlap.circles';
const LIMIT = 8;

export type RecentCircle = {
  slug: string;
  name: string;
  /** Epoch ms of the last visit, for ordering. */
  seenAt: number;
};

function isRecent(value: unknown): value is RecentCircle {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RecentCircle).slug === 'string' &&
    typeof (value as RecentCircle).name === 'string' &&
    typeof (value as RecentCircle).seenAt === 'number'
  );
}

/**
 * Every read and write is guarded. `localStorage` throws outright in some
 * private modes and when site data is blocked, and this is a convenience — it
 * must never be the reason a page fails to render.
 */
export function readRecentCircles(): RecentCircle[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent).sort((a, b) => b.seenAt - a.seenAt);
  } catch {
    return [];
  }
}

export function rememberCircle(slug: string, name: string): void {
  try {
    const existing = readRecentCircles().filter((c) => c.slug !== slug);
    const next = [{ slug, name, seenAt: Date.now() }, ...existing].slice(0, LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Nothing to do and nothing to report: the feature is a convenience.
  }
}

export function forgetCircle(slug: string): void {
  try {
    const next = readRecentCircles().filter((c) => c.slug !== slug);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function forgetAllCircles(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
