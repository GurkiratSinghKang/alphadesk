// qa/harness/tests/strategies-earnings-options-play.mjs
// /strategies/earnings-options-play — research workflow combining the
// EarningsCalendarSidebar, FiltersBar, and EarningsDetailPanel.
export const spec = {
  name: "strategies-earnings-options-play",
  route: "/strategies/earnings-options-play",
  requiresAuth: true,
  viewports: ["desktop-1440", "mobile-390"],
  steps: [
    { kind: "navigate", to: "/strategies/earnings-options-play" },
    { kind: "wait", for: "networkidle", timeout: 20000 },
    { kind: "snapshot", label: "initial" },

    // Click the first calendar row in the sidebar (best-effort — empty calendars
    // are common off-cycle, so this is click-if-present).
    {
      kind: "click-if-present",
      selector: "[data-testid^=earnings-row], [role=button][data-symbol], aside button",
      label: "select-first-row",
    },
    { kind: "wait", for: "networkidle", timeout: 8000 },
    { kind: "snapshot", label: "row-selected" },

    // Hover any status pill in the detail panel.
    {
      kind: "hover-first-if-present",
      selector: "[role=status]",
      waitFor: 300,
    },
    { kind: "snapshot", label: "status-hover" },

    { kind: "scroll", y: 800 },
    { kind: "snapshot", label: "scrolled-mid" },
    { kind: "scroll", y: 9999 },
    { kind: "snapshot", label: "bottom" },
  ],
};
