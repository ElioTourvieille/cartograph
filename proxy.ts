import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The agent's tool surface has no session to protect: its caller is a process
// holding a credential for one analysis, which the route checks through Convex.
const isPublicRoute = createRouteMatcher([
  // The root is the landing page when signed out and the dashboard when signed
  // in; the page itself decides, and every other route stays protected.
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/agent/tools(.*)",
]);

// Everything is protected unless listed above. protect() redirects before any
// page renders, so a signed-out visitor never receives the HTML.
export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
