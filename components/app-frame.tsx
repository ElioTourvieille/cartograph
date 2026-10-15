import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

// The signed-in frame, shared by the (app) routes and by the root page when
// someone is signed in. Clerk creates the first organization at sign-in, so a
// session without one is not expected. If it happens, render nothing of the app
// rather than a workspace that belongs to no team.
export async function AppFrame({ children }: { children: ReactNode }) {
  const { orgId } = await auth();
  if (!orgId) {
    return <main className="p-3 text-xs text-muted">Aucune organisation active.</main>;
  }
  return <AppShell>{children}</AppShell>;
}
