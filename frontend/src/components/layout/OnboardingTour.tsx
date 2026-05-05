"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui";
import { safeSetItem, safeGetItem } from "@/lib/storage";

// ─── Tour Step Definitions ──────────────────────────────────

interface TourStep {
  title: string;
  description: string;
  selector: string; // CSS selector to highlight
  position: "top" | "bottom" | "left" | "right";
  action?: () => void; // optional action on step enter
}

const STORAGE_KEY = "alphadesk-tour-complete";
// New key used by the QA harness (see qa/harness/helpers.mjs::login).
// Either key dismisses the tour; the new key is preferred for fresh writes.
const DISMISSED_KEY = "alphadesk.onboarding_dismissed";
const RUN_AFTER_LOGIN_KEY = "alphadesk.run-tour-after-login";

// Selectors target composites mounted by the flagship `DeskLayout`. The
// audit (R2) caught the old selectors still pointing at legacy dashboard
// panels that no longer exist on `/`. Each step is resolved at
// display-time via `document.querySelector`; if the element isn't on the
// page we skip that step forward automatically.
const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to AlphaDesk!",
    description:
      "Your portfolio KPIs — equity, day P&L, cash, exposure — live here at the top of every desk.",
    selector: "[data-slot='context-bar']",
    position: "bottom",
  },
  {
    title: "Operating Dashboard",
    description:
      "The dashboard is your graphless daily cockpit: account state, risk posture, strategy health, and next actions.",
    selector: "[data-slot='dashboard-command-center']",
    position: "bottom",
  },
  {
    title: "Triage First",
    description:
      "Start with next actions and risk. The full chart and order ticket stay one click away on Trade.",
    selector: "section[aria-labelledby='next-actions-title']",
    position: "bottom",
  },
  {
    title: "Briefing Rail",
    description:
      "Morning brief, watchlist, and book stay in the right rail so the center can remain calm.",
    selector: "[data-slot='dashboard-right']",
    position: "left",
  },
  {
    title: "Command Palette",
    description:
      "Press Cmd+K (or Ctrl+K) to instantly search symbols, run commands, or navigate anywhere in the app.",
    selector: "[aria-label='Open command palette']",
    position: "bottom",
  },
];

// ─── Component ──────────────────────────────────────────────

export function OnboardingTour() {
  // Check synchronously — never show if already completed (either key dismisses).
  // Round-11 / BB-22: safeGetItem swallows Safari Private Mode throws and
  // returns null on failure, so unreadable storage falls through to
  // "show the tour" rather than crashing the dashboard mount.
  const alreadyCompleted =
    typeof window !== "undefined" &&
    (!!safeGetItem(STORAGE_KEY) || safeGetItem(DISMISSED_KEY) === "true");
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const isDashboardRoute = pathname === "/";

  // Wave 3N persona-94 #7: gate the tour on actual login events, not a
  // bare mount. Listen for the `alphadesk:auth-login-success` event the
  // LoginForm dispatches — when it fires, clear the dismissal markers so
  // the tour runs once per successful login. Also honour the original
  // "mount-based" path for users who were already signed in when we added
  // this (no login event has fired, but clearing localStorage manually
  // should still re-trigger the tour — the docstring promises this).
  //
  // Implementation note: we use a secondary `tour-shown-for-login` marker
  // so that rapid re-mounts in the same authenticated session (navigating
  // away and back to `/`) don't keep re-opening the tour. Only a fresh
  // auth event resets it. If the user clears localStorage they get the
  // tour back on next mount — the documented escape hatch.
  const SHOWN_THIS_LOGIN_KEY = "alphadesk.tour-shown-this-login";

  useEffect(() => {
    if (!isDashboardRoute) return undefined;
    try {
      if (sessionStorage.getItem(RUN_AFTER_LOGIN_KEY) === "1") {
        sessionStorage.removeItem(RUN_AFTER_LOGIN_KEY);
        sessionStorage.setItem(SHOWN_THIS_LOGIN_KEY, "1");
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(DISMISSED_KEY);
        const timer = setTimeout(() => setActive(true), 1500);
        return () => clearTimeout(timer);
      }
    } catch {
      // Storage unavailable — fall through to the normal mount path.
    }
    // Mount path — honour the original contract.
    if (!alreadyCompleted) {
      const timer = setTimeout(() => setActive(true), 1500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [alreadyCompleted, isDashboardRoute]);

  useEffect(() => {
    if (!isDashboardRoute) return undefined;
    if (typeof window === "undefined") return undefined;
    // Auth path — every login resets dismissal markers and re-shows the
    // tour once, unless we've already shown it for THIS login session.
    const handler = () => {
      try {
        // Idempotent: don't re-show inside the same authenticated session
        // if the user already dismissed the tour after logging in.
        if (sessionStorage.getItem(SHOWN_THIS_LOGIN_KEY) === "1") return;
        sessionStorage.setItem(SHOWN_THIS_LOGIN_KEY, "1");
        // Reset the persistent "I've seen the tour" markers so the
        // effect below picks up and the tour runs fresh.
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(DISMISSED_KEY);
      } catch {
        // Storage unavailable (private mode etc.) — fall back to just
        // activating the tour for this mount.
      }
      // Small delay so the dashboard has time to mount the targets.
      window.setTimeout(() => setActive(true), 1500);
    };
    window.addEventListener("alphadesk:auth-login-success", handler as EventListener);
    return () => {
      window.removeEventListener("alphadesk:auth-login-success", handler as EventListener);
    };
  }, [isDashboardRoute]);

  // Position the spotlight on the current step's element. If the target
  // element isn't on the page, advance to the next step that *is* (up to
  // the last step, which falls back to a center-positioned tooltip).
  const updateSpotlight = useCallback(() => {
    if (!active) return;
    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    const el = document.querySelector(step.selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      setSpotlightRect(rect);
      return;
    }

    // Element not on page — try the next available step rather than
    // showing an un-anchored tooltip.
    for (let i = currentStep + 1; i < TOUR_STEPS.length; i += 1) {
      const nextEl = document.querySelector(TOUR_STEPS[i].selector);
      if (nextEl) {
        setCurrentStep(i);
        return;
      }
    }
    // No remaining steps have targets — show center fallback
    setSpotlightRect(null);
  }, [active, currentStep]);

  useEffect(() => {
    const initialFrame = requestAnimationFrame(updateSpotlight);

    // Update on scroll/resize
    const handleUpdate = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateSpotlight);
    };
    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);
    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
      cancelAnimationFrame(initialFrame);
      cancelAnimationFrame(rafRef.current);
    };
  }, [updateSpotlight]);

  // Run step action when step changes
  useEffect(() => {
    if (!active) return;
    const step = TOUR_STEPS[currentStep];
    if (step?.action) {
      step.action();
    }
  }, [active, currentStep]);

  const completeTour = useCallback(() => {
    safeSetItem(STORAGE_KEY, "1");
    safeSetItem(DISMISSED_KEY, "true");
    setActive(false);
    setCommandPaletteOpen(false);
  }, [setCommandPaletteOpen]);

  // Wave 32 persona-6 #5: Esc closes the tour. Captures at the document
  // level so it works regardless of whether the tooltip currently has focus.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        completeTour();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [active, completeTour]);

  // Wave 32 persona-6 #5: focus the first interactive element in the tooltip
  // (the Skip button) on tour open so keyboard users land on a real control
  // instead of whatever sat beneath the backdrop.
  useEffect(() => {
    if (!active) return;
    // RAF guarantees the tooltip is in the DOM before focusing — the
    // spotlight effect needs a layout pass first.
    const id = requestAnimationFrame(() => {
      const root = tooltipRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      first?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [active, currentStep]);

  // Wave 32 persona-6 #5: focus trap. Tab on the last interactive element
  // loops back to the first; Shift+Tab on the first loops to the last.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = tooltipRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !root.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !root.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      completeTour();
    }
  }, [currentStep, completeTour]);

  const handleSkip = useCallback(() => {
    completeTour();
  }, [completeTour]);

  if (!active) return null;

  const step = TOUR_STEPS[currentStep];
  const isLastStep = currentStep === TOUR_STEPS.length - 1;
  const padding = 8; // padding around the highlighted element

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!spotlightRect) {
      // Center fallback
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    // Wave 29 persona-5 #6: tooltip was `w-80` (320px) with 16px side clamp,
    // which overflowed a 390px viewport once the spotlight sat near an edge.
    // Match the CSS width formula below so position math tracks actual size.
    const tooltipWidth = Math.min(
      320,
      typeof window !== "undefined" ? window.innerWidth - 32 : 320
    );
    const tooltipHeight = 160;
    const gap = 12;

    switch (step.position) {
      case "bottom":
        return {
          top: spotlightRect.bottom + gap + padding,
          left: Math.max(
            16,
            Math.min(
              spotlightRect.left + spotlightRect.width / 2 - tooltipWidth / 2,
              window.innerWidth - tooltipWidth - 16
            )
          ),
        };
      case "top":
        return {
          top: spotlightRect.top - tooltipHeight - gap - padding,
          left: Math.max(
            16,
            Math.min(
              spotlightRect.left + spotlightRect.width / 2 - tooltipWidth / 2,
              window.innerWidth - tooltipWidth - 16
            )
          ),
        };
      case "left":
        return {
          top: Math.max(
            16,
            spotlightRect.top + spotlightRect.height / 2 - tooltipHeight / 2
          ),
          left: Math.max(16, spotlightRect.left - tooltipWidth - gap - padding),
        };
      case "right":
        return {
          top: Math.max(
            16,
            spotlightRect.top + spotlightRect.height / 2 - tooltipHeight / 2
          ),
          left: spotlightRect.right + gap + padding,
        };
      default:
        return {
          top: spotlightRect.bottom + gap,
          left: spotlightRect.left,
        };
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100]"
      aria-modal="true"
      aria-labelledby="onboarding-tour-title"
      aria-describedby="onboarding-tour-description"
      role="dialog"
      data-testid="onboarding-tour"
    >
      {/* Dark overlay with cutout */}
      <div className="absolute inset-0">
        {/* Full overlay — click-through dismiss */}
        <button
          type="button"
          aria-label="Dismiss onboarding tour"
          onClick={completeTour}
          className="absolute inset-0 bg-black/60 transition-all duration-300 cursor-pointer"
          data-testid="onboarding-tour-backdrop"
        />

        {/* Spotlight cutout */}
        {spotlightRect && (
          <div
            className="absolute rounded-lg transition-all duration-300 ease-out"
            style={{
              top: spotlightRect.top - padding,
              left: spotlightRect.left - padding,
              width: spotlightRect.width + padding * 2,
              height: spotlightRect.height + padding * 2,
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
              zIndex: 1,
            }}
          >
            {/* Glow ring */}
            <div className="absolute inset-0 rounded-lg ring-2 ring-primary/50 animate-pulse" />
          </div>
        )}
      </div>

      {/* Tooltip */}
      {/* Wave 29 persona-5 #6: `w-80` (320px) overflowed 390px viewport
          because the 16px side clamps still left room for a 320px panel
          to bleed past. `w-[calc(100vw-2rem)] max-w-80` keeps the natural
          320px on desk but clamps to the viewport minus 32px on mobile. */}
      <div
        ref={tooltipRef}
        className="absolute z-10 w-[calc(100vw-2rem)] max-w-80 rounded-xl border border-primary/30 bg-[var(--bg-card)] p-5 shadow-2xl transition-all duration-300"
        style={getTooltipStyle()}
      >
        {/* Step counter */}
        <div className="flex items-center gap-1.5 mb-3">
          {TOUR_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentStep ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>

        <h3 id="onboarding-tour-title" className="text-sm font-bold text-foreground mb-1.5">
          {step.title}
        </h3>
        <p id="onboarding-tour-description" className="text-label text-muted-foreground leading-relaxed mb-4">
          {step.description}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-label text-muted-foreground tabular-nums">
            {currentStep + 1} of {TOUR_STEPS.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="h-11 text-label text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
            <Button
              size="sm"
              onClick={handleNext}
              className="h-11 text-label"
            >
              {isLastStep ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
