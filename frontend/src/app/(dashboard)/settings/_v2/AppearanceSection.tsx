"use client";

import * as React from "react";

import Section from "@/components/composites/Section";
import ControlModule from "@/components/composites/ControlModule";
import {
  usePreferencesStore,
  type DensityPreference,
  type ThemePreference,
} from "@/stores/preferences";
import { cn } from "@/lib/utils";

/**
 * v2 Settings · Appearance section per v2-plan §1.5.
 *
 * Demonstrates the ControlModule primitive scoped to a user
 * (scope="user"), with the new v2 density toggle wired through
 * usePreferencesStore. Theme toggle is mirrored here for parity
 * with the rest of the v2 Settings tabbed shell (the existing
 * SettingsPage keeps its top-level theme controls unchanged for
 * now).
 *
 * Phase 1.5 follow-up will tab this with Account · Trading · Risk
 * · Alerts · Data · Shortcuts · Privacy & data · Danger sections.
 */
const DENSITY_OPTIONS: { value: DensityPreference; label: string; desc: string }[] = [
  { value: "quiet", label: "Quiet", desc: "Editorial spacing — calmer dashboard rhythm." },
  { value: "dense", label: "Dense", desc: "Tighter rows for active-trader workflows." },
];

const THEME_OPTIONS: { value: ThemePreference; label: string; desc: string }[] = [
  { value: "system", label: "System", desc: "Follow OS preference." },
  { value: "dark",   label: "Dark",   desc: "Editorial ink + gold." },
  { value: "light",  label: "Light",  desc: "Warm-paper · v2 cream + warm-brown + moss/rust." },
];

export default function AppearanceSection() {
  const density = usePreferencesStore((s) => s.display.density);
  const theme = usePreferencesStore((s) => s.display.theme);
  const setDisplayPref = usePreferencesStore((s) => s.setDisplayPref);

  return (
    <Section
      eyebrow="SETTINGS · APPEARANCE"
      title="Appearance"
      description="Density + theme + paper-mode color treatment. Stored locally; cross-tab synced."
    >
      <div className="grid gap-3 md:grid-cols-2">
        <ControlModule
          name="Density"
          desc="Editorial-quiet (default per v2 brand) or dense for active-trader workflows."
          scope="user"
          control={
            <Segmented
              value={density}
              options={DENSITY_OPTIONS}
              onChange={(v) => setDisplayPref("density", v)}
            />
          }
        />
        <ControlModule
          name="Theme"
          desc="Dark by default. Light theme uses the v2 warm-paper palette (cream · warm-brown · moss/rust)."
          scope="user"
          control={
            <Segmented
              value={theme}
              options={THEME_OPTIONS}
              onChange={(v) => setDisplayPref("theme", v)}
            />
          }
        />
      </div>
    </Section>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; desc: string }[];
  onChange: (next: T) => void;
}

function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="space-y-2">
      <div role="group" className="inline-flex rounded-pill border border-border bg-bg-elev-2 p-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1 rounded-pill text-eyebrow font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
              value === opt.value
                ? "bg-bg-elev-1 text-fg shadow-hair"
                : "text-fg-muted hover:text-fg",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-body-sm text-fg-muted italic">
        {options.find((o) => o.value === value)?.desc}
      </p>
    </div>
  );
}
