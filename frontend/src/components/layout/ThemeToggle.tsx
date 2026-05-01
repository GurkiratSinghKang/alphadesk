"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/preferences";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = usePreferencesStore((s) => s.display.theme);
  const setDisplayPref = usePreferencesStore((s) => s.setDisplayPref);
  const [systemLight, setSystemLight] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const sync = () => setSystemLight(media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  const light = theme === "light" || (theme === "system" && systemLight);
  const next = light ? "dark" : "light";
  const label = light ? "Switch to dark mode" : "Switch to light mode";
  const Icon = light ? Moon : Sun;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setDisplayPref("theme", next)}
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md sm:h-8 sm:w-8",
        "border border-border bg-bg-elev-1 text-fg-muted",
        "hover:border-brand/60 hover:text-brand hover:bg-brand-tint",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
