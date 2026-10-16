import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getInstallation, GithubAppError } from "@/lib/github/app";
import { matchesCookie, STATE_COOKIE, stateIsFor } from "@/lib/github/state";

// Where GitHub sends the person back after installing the App (the App's Setup
// URL). Nothing in this request is believed on its own:
//
//   - the organization is the one in the person's verified session, and the
//     signed state must have been made for exactly it, unexpired, and equal to
//     the cookie this browser was given when the flow began;
//   - the installation id in the query is only a claim. GitHub is asked about
//     it as the App, and the mutation that records it refuses one that is
//     another organization's, or old and unclaimed.
//
// It never asks for, receives or stores a GitHub user token.

export const dynamic = "force-dynamic";

const back = (request: Request, query: string) =>
  NextResponse.redirect(new URL(`/parametres?${query}`, request.url));

export async function GET(request: Request): Promise<Response> {
  const { userId, orgId, getToken } = await auth();
  if (!userId || !orgId) return NextResponse.redirect(new URL("/sign-in", request.url));
  const token = await getToken();
  if (token === null) return NextResponse.redirect(new URL("/sign-in", request.url));

  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const rawId = params.get("installation_id") ?? "";
  const cookie = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${STATE_COOKIE}=`))
    ?.slice(STATE_COOKIE.length + 1);

  // One use: the cookie is cleared whatever happens next.
  const finish = (response: NextResponse): NextResponse => {
    response.cookies.set(STATE_COOKIE, "", { path: "/api/github", maxAge: 0 });
    return response;
  };

  let stateOk = false;
  try {
    stateOk =
      state !== "" &&
      stateIsFor(state, orgId) &&
      matchesCookie(state, cookie === undefined ? undefined : decodeURIComponent(cookie));
  } catch {
    stateOk = false;
  }
  if (!stateOk) return finish(back(request, "erreur=etat"));
  if (!/^\d{1,15}$/.test(rawId)) return finish(back(request, "erreur=installation"));
  const githubId = Number(rawId);

  try {
    const installation = await getInstallation(githubId);
    if (installation === null) return finish(back(request, "erreur=installation"));
    await fetchMutation(
      api.installations.claim,
      {
        githubId,
        account: installation.account,
        githubCreatedAt: installation.createdAt,
        secret: process.env.PIPELINE_SECRET ?? "",
      },
      { token },
    );
    return finish(back(request, "connecte=1"));
  } catch (error) {
    if (error instanceof ConvexError) {
      // A code, never the message: the page writes its own sentence for each,
      // so nothing a URL carries is ever shown as text.
      const message = String(error.data);
      const code = message.includes("autre organisation")
        ? "autre"
        : message.includes("dix minutes")
          ? "ancienne"
          : "refus";
      return finish(back(request, `erreur=${code}`));
    }
    console.error("[github/installed]", error instanceof GithubAppError ? error.message : error);
    return finish(back(request, "erreur=github"));
  }
}
