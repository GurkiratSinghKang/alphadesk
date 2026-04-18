"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui";

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
    title: "Automated Strategies",
    description:
      "The rail on the left lists every strategy. Click one to highlight it and see its positions in the panel.",
    selector: "[data-slot='strategy-rail']",
    position: "right",
  },
  {
    title: "Chart & Execution",
    description:
      "Pick a range with the chart buttons; stage orders below with the symbol, qty, and type you need.",
    selector: "[data-slot='price-chart-panel']",
    position: "bottom",
  },
  {
    title: "Order Bar",
    description:
      "Buy, sell, limits, stops — all from the same row. Press B or S for a quick buy/sell at market.",
    selector: "[data-tour='order-bar']",
    position: "top",
  },
  {
    title: "Command Palette",
    description:
      "Press Cmd+K (or Ctrl+K) to instantly search symbols, run commands, or navigate anywhere in the app.",
    selector: "[data-tour='profile-menu']",
    position: "bottom",
  },
];

// ─── Component ──────────────────────────────────────────────

export function OnboardingTour() {
  // Check synchronously — never show if already completed (either key dismisses).
  const alreadyCompleted =
    typeof window !== "undefined" &&
    (!!localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(DISMISSED_KEY) === "true");
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);

  // Show tour on first visit only, with delay for dashboard to render
  useEffect(() => {
    if (alreadyCompleted) return;
    const timer = setTimeout(() => setActive(true), 1500);
    return () => clearTimeout(timer);
  }, [alreadyCompleted]);

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
    updateSpotlight();

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
    localStorage.setItem(STORAGE_KEY, "1");
    localStorage.setItem(DISMISSED_KEY, "true");
    setActive(false);
    setCommandPaletteOpen(false);
  }, [setCommandPaletteOpen]);

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

    const tooltipWidth = 320;
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
      <div
        className="absolute z-10 w-80 rounded-xl border border-primary/30 bg-[var(--surface)] p-5 shadow-2xl transition-all duration-300"
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

        <h3 className="text-sm font-bold text-foreground mb-1.5">
          {step.title}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">
          {step.description}
        </p>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {currentStep + 1} of {TOUR_STEPS.length}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="text-xs h-7 text-muted-foreground hover:text-foreground"
            >
              Skip
            </Button>
            <Button
              size="sm"
              onClick={handleNext}
              className="text-xs h-7"
            >
              {isLastStep ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
