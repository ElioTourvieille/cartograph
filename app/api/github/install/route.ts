import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { makeState, STATE_COOKIE, STATE_TTL_MS } from "@/lib/github/state";

// Where "Connecter GitHub" leads. The organization comes from the person's
// verified session; the state carries it to GitHub and back, signed, and the
// same value is kept in an HttpOnly cookie that only this browser holds. Behind
// sign-in like every route that is not listed in proxy.ts.

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return NextResponse.redirect(new URL("/sign-in", request.url));

  const slug = process.env.GITHUB_APP_SLUG;
  if (slug === undefined || slug === "") {
    return NextResponse.redirect(new URL("/parametres?erreur=configuration", request.url));
  }

  const state = makeState(orgId);
  const response = NextResponse.redirect(
    `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`,
  );
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/github",
    maxAge: STATE_TTL_MS / 1000,
  });
  return response;
}
