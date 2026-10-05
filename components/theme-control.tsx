"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY, THEMES, type Theme } from "@/lib/theme";

const LABELS: Record<Theme, string> = {
  system: "Système",
  light: "Clair",
  dark: "Sombre",
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

// The choice lives on <html data-theme>, which the colour tokens key off.
// "system" removes the attribute so the OS preference applies.
function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
  listeners.forEach((listener) => listener());
}

export function ThemeControl() {
  const current = useSyncExternalStore(subscribe, read, () => "system" as const);

  return (
    <div role="group" aria-label="Thème" className="flex gap-px">
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          aria-pressed={current === theme}
          onClick={() => apply(theme)}
          className="border border-border px-2 py-0.5 text-xs text-muted first:rounded-l last:rounded-r aria-pressed:border-accent aria-pressed:text-accent"
        >
          {LABELS[theme]}
        </button>
      ))}
    </div>
  );
}
