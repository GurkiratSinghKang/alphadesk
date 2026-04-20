"use client";

/**
 * Owns the drawings state for a chart symbol and persists to localStorage.
 * v1: client-only, no server sync. Cap 50 per symbol (drop oldest on
 * overflow). Silent on parse / write failures.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Drawing } from "@/components/charts/drawingPlugin";

const STORAGE_PREFIX = "alphadesk.chart.drawings.v1:";
const MAX_PER_SYMBOL = 50;

function storageKey(symbol: string): string {
  return `${STORAGE_PREFIX}${symbol}`;
}

function readFromStorage(symbol: string): Drawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Drawing[]) : [];
  } catch {
    return [];
  }
}

function writeToStorage(symbol: string, drawings: Drawing[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(symbol), JSON.stringify(drawings));
  } catch {
    // Quota exceeded or storage unavailable — silent.
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `d_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export interface UseChartDrawings {
  drawings: Drawing[];
  add: (d: Omit<Drawing, "id" | "createdAt">) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export function useChartDrawings(symbol: string): UseChartDrawings {
  // Unconditional hook declarations first (rules-of-hooks).
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const symbolRef = useRef(symbol);

  // Load on symbol change. Runs on the client only (effects are skipped on
  // the server), so no SSR hydration mismatch on localStorage reads.
  useEffect(() => {
    symbolRef.current = symbol;
    setDrawings(readFromStorage(symbol));
  }, [symbol]);

  const add = useCallback((d: Omit<Drawing, "id" | "createdAt">) => {
    setDrawings((prev) => {
      const entry: Drawing = { ...d, id: makeId(), createdAt: Date.now() };
      const next = [...prev, entry];
      const trimmed = next.length > MAX_PER_SYMBOL ? next.slice(next.length - MAX_PER_SYMBOL) : next;
      writeToStorage(symbolRef.current, trimmed);
      return trimmed;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setDrawings((prev) => {
      const next = prev.filter((d) => d.id !== id);
      writeToStorage(symbolRef.current, next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setDrawings(() => {
      writeToStorage(symbolRef.current, []);
      return [];
    });
  }, []);

  return { drawings, add, remove, clear };
}
