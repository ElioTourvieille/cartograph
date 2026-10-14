import type { AuthConfig } from "convex/server";

// Convex trusts tokens issued by Clerk's Frontend API. The URL lives in the
// Convex deployment env (CLERK_FRONTEND_API_URL), not in the repo.
// The second provider is the agent's credential: a short-lived token our own
// server signs for ONE analysis (see lib/agent/credential.ts). Convex checks its
// signature against the public key in AGENT_JWKS_URI, an inline `data:` JWKS
// so nothing has to be reachable from the deployment. Without that variable
// the provider is absent and no agent credential can be accepted at all.
const agentJwks = process.env.AGENT_JWKS_URI;

export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
    ...(agentJwks === undefined || agentJwks === ""
      ? []
      : [
          {
            type: "customJwt" as const,
            applicationID: "cartograph-agent",
            // Convex wants a URL-shaped issuer; it is only compared, never fetched.
            issuer: "https://cartograph.local",
            jwks: agentJwks,
            algorithm: "RS256" as const,
          },
        ]),
  ],
} satisfies AuthConfig;
