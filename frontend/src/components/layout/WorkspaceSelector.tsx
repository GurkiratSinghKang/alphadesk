"use client";

import { useState, useEffect, useCallback } from "react";
import { Layout } from "lucide-react";
import { useToast } from "@/hooks/useToast";
import { safeGetItem, safeSetItem } from "@/lib/storage";

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
    const stored = safeGetItem(STORAGE_KEY);
    if (stored && stored in WORKSPACE_CONFIGS) {
      setWorkspaceState(stored as WorkspaceId);
    }
  }, []);

  const setWorkspace = useCallback((ws: WorkspaceId) => {
    setWorkspaceState(ws);
    safeSetItem(STORAGE_KEY, ws);
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
  const { workspace, setWorkspace, config } = useWorkspace();
  const { toast } = useToast();

  const handleChange = (ws: WorkspaceId) => {
    if (ws === workspace) return;
    setWorkspace(ws);
    // Give honest feedback — the event is fired so that non-desk pages
    // using `useWorkspace().isExpanded(...)` collapse/expand accordingly,
    // but the desk route currently ignores it (audit P1). Toast the switch
    // so the user knows the preference was saved, and mention which
    // sections become emphasised.
    toast({
      type: "info",
      message: `Workspace: ${WORKSPACE_CONFIGS[ws].label} (${WORKSPACE_CONFIGS[ws].expanded.length} sections emphasised)`,
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <Layout className="h-3 w-3 text-muted-foreground" />
      <select
        value={workspace}
        onChange={(e) => handleChange(e.target.value as WorkspaceId)}
        aria-label="Workspace layout"
        title={`Current: ${config.label} — ${config.expanded.length} sections`}
        className="h-7 rounded border border-border bg-background px-2 text-[12px] text-foreground cursor-pointer hover:border-primary/50 transition-colors"
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
