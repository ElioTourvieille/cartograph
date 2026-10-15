// The hand-off between the landing page and the dashboard. An address typed in
// the hero has to survive the trip through sign-in, and it is kept in
// sessionStorage rather than the URL: a link someone else made cannot put an
// address in YOUR tab's storage, so it cannot make your organization analyse
// something by being clicked. Lost storage (another tab, a mail link) just
// means the dashboard opens with an empty field.

const KEY = "cartograph:pending-repo";

export function keepPending(url: string): void {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    // Storage unavailable: the person types it again after signing in.
  }
}

/** Reads the kept address and forgets it, so it is used once. */
export function takePending(): string | null {
  try {
    const url = sessionStorage.getItem(KEY);
    if (url === null) return null;
    sessionStorage.removeItem(KEY);
    return url.trim() === "" ? null : url;
  } catch {
    return null;
  }
}
