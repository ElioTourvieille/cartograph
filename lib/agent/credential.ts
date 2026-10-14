import { createPrivateKey, createSign } from "node:crypto";

// The agent's credential: a JWT our server signs for ONE analysis and the
// organization that owns it. Convex accepts it as a second token issuer
// (convex/auth.config.ts) and its builders read the same organization claim they
// read from a person's session, plus the `analysis` claim that narrows the read.
// Nothing else is in it, and it expires in minutes: it is created per question.
//
// The private key lives only in this server's environment (AGENT_PRIVATE_KEY,
// a PEM, base64 on one line). The public half is on the Convex deployment as
// AGENT_JWKS_URI. `pnpm agent:keys` makes both.

// Must equal `issuer` in convex/auth.config.ts. URL-shaped because Convex asks
// for that; it is only compared, never fetched.
export const ISSUER = "https://cartograph.local";
export const AUDIENCE = "cartograph-agent";
export const KEY_ID = "agent-1";
/** A question takes seconds; this is long enough for a slow one and no longer. */
export const TTL_SECONDS = 5 * 60;

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

function privateKey() {
  const raw = process.env.AGENT_PRIVATE_KEY;
  if (raw === undefined || raw === "") {
    throw new Error(
      "AGENT_PRIVATE_KEY manque dans .env.local : aucun jeton d'agent ne peut être signé (pnpm agent:keys).",
    );
  }
  return createPrivateKey(Buffer.from(raw, "base64").toString("utf8"));
}

export function mintCredential(input: {
  orgId: string;
  analysisId: string;
  /** Seconds since the epoch; a test passes one, the app never does. */
  now?: number;
  ttl?: number;
}): string {
  const iat = input.now ?? Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: KEY_ID };
  const claims = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: `analysis:${input.analysisId}`,
    iat,
    exp: iat + (input.ttl ?? TTL_SECONDS),
    // The organization, in the two shapes the builders read (Clerk's nested
    // `o.id`, and the flat `org_id` older templates use).
    o: { id: input.orgId },
    org_id: input.orgId,
    analysis: input.analysisId,
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(body).sign(privateKey());
  return `${body}.${b64url(signature)}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The analysis a credential NAMES, read without checking the signature. Only
 * used to tell Convex which analysis to look up; Convex is what verifies the
 * signature, the expiry and the issuer, and a forged claim fails there. Null
 * for anything that is not three dot-separated parts with that claim.
 */
export function claimedAnalysis(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!isRecord(claims)) return null;
    return typeof claims.analysis === "string" && claims.analysis !== "" ? claims.analysis : null;
  } catch {
    return null;
  }
}
