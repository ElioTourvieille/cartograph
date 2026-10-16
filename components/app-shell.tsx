import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeControl } from "@/components/theme-control";

// The frame every later phase renders inside. Panels get added to <main>;
// the bar stays as it is.
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
        <Link href="/" className="text-xs font-semibold">
          Cartograph
        </Link>
        <OrganizationSwitcher hidePersonal />
        <Link href="/parametres" className="text-xs text-muted hover:text-foreground">
          Paramètres
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <ThemeControl />
          <UserButton />
        </div>
      </header>
      <main className="flex-1 p-3">{children}</main>
    </div>
  );
}
