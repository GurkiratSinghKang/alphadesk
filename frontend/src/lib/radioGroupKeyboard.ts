import type * as React from "react";

/**
 * Audit A-F2 (2026-05-05): WCAG 2.1.1 + ARIA APG — every
 * ``role="radiogroup"`` must support arrow-key navigation between
 * its ``role="radio"`` children. Tab moves between groups; Arrow
 * keys cycle within a group. The eight radiogroups across
 * /settings, /strategies, /strategies/{id}, /reports, and the
 * earnings filters bar previously only worked with mouse + Tab —
 * keyboard-only users had to Tab through every option which broke
 * the radio-group mental model and the screen-reader announcement
 * for "X of Y selected".
 *
 * Shared keyboard handler installed on the ``role="radiogroup"``
 * container element. It walks DOM children matching
 * ``[role="radio"]`` and routes Arrow / Home / End to the
 * appropriate sibling, calling its ``click()`` to trigger the same
 * onClick the caller already wired (which both updates state and
 * sets ``aria-checked``). This keeps the existing onClick pathway
 * authoritative — no duplicate state machinery.
 */
export function handleRadioGroupKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
  const key = event.key;
  if (
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "ArrowUp" &&
    key !== "ArrowDown" &&
    key !== "Home" &&
    key !== "End"
  ) {
    return;
  }

  const container = event.currentTarget;
  const radios = Array.from(
    container.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'),
  );
  if (radios.length === 0) return;

  const current = document.activeElement as HTMLElement | null;
  const currentIndex = current ? radios.indexOf(current) : -1;

  let nextIndex: number;
  if (key === "Home") {
    nextIndex = 0;
  } else if (key === "End") {
    nextIndex = radios.length - 1;
  } else {
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const direction = key === "ArrowRight" || key === "ArrowDown" ? 1 : -1;
    nextIndex = (startIndex + direction + radios.length) % radios.length;
  }

  const next = radios[nextIndex];
  if (!next) return;

  event.preventDefault();
  next.focus();
  // Activate the radio so aria-checked + parent state advance
  // together — matches the WAI-ARIA APG "Radio Group, Activated on
  // Focus" pattern. Each radio is a <button> that already has the
  // onClick wired to the parent's setState; we just trigger it.
  next.click();
}
