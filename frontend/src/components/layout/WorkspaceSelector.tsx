"use client";

import { useState, useEffect, useCallback } from "react";
import { Layout } from "lucide-react";

// ─── Workspace Types ────────────────────────────────────────────

export type WorkspaceId = "default" | "research" | "trading" | "risk" | "eod";

export interface WorkspaceConfig {
  label: string;
  /** Sections that should be expanded (all others compact) */
  expanded: string[];
  /** Whether the AI copilot auto-opens */
  copilotOpen?: boolean;
  /** Whether the ticker tape should show */
  tickerTape?: boolean;
}

export const WORKSPACE_CONFIGS: Record<WorkspaceId, WorkspaceConfig> = {
  default: {
    label: "Default",
    expanded: ["hero", "brief", "activity", "signals", "positions", "calendar", "risk", "stress", "economic", "strategies", "attribution", "correlation", "market", "movers", "breadth"],
  },
  research: {
    label: "Morning Research",
    expanded: ["hero", "brief", "activity", "signals", "market", "economic", "strategies"],
    copilotOpen: true,
  },
  trading: {
    label: "Active Trading",
    expanded: ["hero", "positions", "signals", "strategies", "movers"],
    tickerTape: true,
  },
  risk: {
    label: "Risk Monitoring",
    expanded: ["hero", "risk", "stress", "correlation", "positions", "market", "breadth"],
  },
  eod: {
    label: "End of Day",
    expanded: ["hero", "calendar", "attribution", "strategies", "market", "correlation"],
  },
};

const STORAGE_KEY = "alphadesk-workspace";

export function useWorkspace() {
  const [workspace, setWorkspaceState] = useState<WorkspaceId>("default");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in WORKSPACE_CONFIGS) {
      setWorkspaceState(stored as WorkspaceId);
    }
  }, []);

  const setWorkspace = useCallback((ws: WorkspaceId) => {
    setWorkspaceState(ws);
    localStorage.setItem(STORAGE_KEY, ws);
    // Dispatch event so other components can react
    window.dispatchEvent(new CustomEvent("alphadesk:workspace-change", { detail: { workspace: ws } }));
  }, []);

  const config = WORKSPACE_CONFIGS[workspace];

  const isExpanded = useCallback(
    (section: string) => config.expanded.includes(section),
    [config]
  );

  return { workspace, setWorkspace, config, isExpanded };
}

export function WorkspaceSelector() {
  const { workspace, setWorkspace } = useWorkspace();

  return (
    <div className="flex items-center gap-1.5">
      <Layout className="h-3 w-3 text-muted-foreground" />
      <select
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value as WorkspaceId)}
        aria-label="Workspace layout"
        className="h-7 rounded border border-border bg-background px-2 text-[11px] text-foreground cursor-pointer hover:border-primary/50 transition-colors"
      >
        <option value="default">Default</option>
        <option value="research">Morning Research</option>
        <option value="trading">Active Trading</option>
        <option value="risk">Risk Monitoring</option>
        <option value="eod">End of Day</option>
      </select>
    </div>
  );
}
