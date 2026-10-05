import type { AuthConfig } from "convex/server";

// Convex trusts tokens issued by Clerk's Frontend API. The URL lives in the
// Convex deployment env (CLERK_FRONTEND_API_URL), not in the repo.
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
