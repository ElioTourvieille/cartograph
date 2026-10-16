import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The value that goes round the trip to GitHub and back when an organization
// connects an installation. It proves WHICH organization started the flow and
// cannot be replayed: it is signed with a server-only secret, it expires in ten
// minutes, it carries a random nonce, and it only counts if the same value is
// also in the HttpOnly cookie set when the flow began (so a link someone else
// built, or a value copied from a log, does nothing in another browser).

export const STATE_COOKIE = "cartograph_gh_state";
export const STATE_TTL_MS = 10 * 60_000;

function secret(): string {
  const value = process.env.INSTALL_STATE_SECRET;
  if (value === undefined || value === "") {
    throw new Error("INSTALL_STATE_SECRET manque dans .env.local.");
  }
  return value;
}

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

export function makeState(orgId: string, now: number = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ o: orgId, n: randomBytes(16).toString("hex"), e: now + STATE_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True only for an unexpired state, signed by us, for exactly this organization. */
export function stateIsFor(state: string, orgId: string, now: number = Date.now()): boolean {
  const [payload, signature, extra] = state.split(".");
  if (payload === undefined || signature === undefined || extra !== undefined) return false;
  if (!same(signature, sign(payload))) return false;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return false;
    const { o, e } = claims as { o?: unknown; e?: unknown };
    return o === orgId && typeof e === "number" && e > now;
  } catch {
    return false;
  }
}

/** The returned state must be the very value the cookie holds. */
export const matchesCookie = (state: string, cookie: string | undefined): boolean =>
  cookie !== undefined && same(state, cookie);
