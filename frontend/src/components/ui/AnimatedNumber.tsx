"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  format: (n: number) => string;
  className?: string;
  duration?: number;
}

/**
 * Smoothly animates between number values using requestAnimationFrame.
 * Falls back to instant display when reduced motion is preferred.
 *
 * Wraps the number in JetBrains Mono + tabular-nums — numbers NEVER render in
 * a proportional sans in AlphaDesk.
 */
export function AnimatedNumber({ value, format, className = "", duration = 300 }: AnimatedNumberProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(safeValue);
  const prevRef = useRef(safeValue);
  const rafRef = useRef<number>(0);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    const to = safeValue;
    prevRef.current = safeValue;

    if (from === to) return;

    // Flash color briefly on change
    setFlash(to > from ? "up" : "down");
    const flashTimer = setTimeout(() => setFlash(null), 600);

    // Check for reduced motion
    const prefersReduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setDisplay(to);
      return () => clearTimeout(flashTimer);
    }

    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(from + (to - from) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(flashTimer);
    };
  }, [safeValue, duration]);

  return (
    <span
      className={cn(
        "font-mono tabular-nums num-transition",
        flash === "up" && "flash-profit",
        flash === "down" && "flash-loss",
        className
      )}
    >
      {format(display)}
    </span>
  );
}
