"use client";

/**
 * Position-management exit-rules admin panel (PM-5).
 *
 * Wave 5A (audit/2026-05-05-position-management). Minimal CRUD UI for
 * the configurable exit-rules engine: list, toggle, add, delete.
 * Backed by `/api/v1/exit-rules` (see `backend/api/routes/exit_rules.py`).
 *
 * Intentionally NOT over-engineered — the goal is "verify the engine is
 * operating", not "build a full rule-management product". A prettier
 * builder can replace this once the engine has cycled through its
 * first month of production firings.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

type RuleType = "profit_pct" | "time_dte" | "loss_pct" | "delta_breach";
type RuleAction = "close" | "roll" | "alert";

interface ExitRule {
  id: number;
  strategy: string | null;
  structure_type: string | null;
  rule_type: RuleType;
  threshold: number;
  action: RuleAction;
  enabled: boolean;
  priority: number;
  description: string | null;
}

const ENDPOINT = "/api/v1/exit-rules";

async function apiList(): Promise<ExitRule[]> {
  const res = await fetch(ENDPOINT, { credentials: "include" });
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return res.json();
}

async function apiPatch(id: number, patch: Partial<ExitRule>): Promise<void> {
  const res = await fetch(`${ENDPOINT}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
}

async function apiCreate(payload: Omit<ExitRule, "id">): Promise<void> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status}`);
}

async function apiDelete(id: number): Promise<void> {
  const res = await fetch(`${ENDPOINT}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}

const RULE_TYPE_OPTIONS: RuleType[] = ["profit_pct", "time_dte", "loss_pct", "delta_breach"];
const ACTION_OPTIONS: RuleAction[] = ["close", "alert", "roll"];

export default function ExitRulesPanel() {
  const [rules, setRules] = useState<ExitRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [strategy, setStrategy] = useState("");
  const [structureType, setStructureType] = useState("");
  const [ruleType, setRuleType] = useState<RuleType>("profit_pct");
  const [threshold, setThreshold] = useState<string>("0.50");
  const [action, setAction] = useState<RuleAction>("close");
  const [priority, setPriority] = useState<string>("100");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiList();
      setRules(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onToggle = useCallback(
    async (rule: ExitRule) => {
      try {
        await apiPatch(rule.id, { enabled: !rule.enabled });
        await reload();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [reload],
  );

  const onDelete = useCallback(
    async (rule: ExitRule) => {
      if (!confirm(`Delete rule #${rule.id} (${rule.rule_type} → ${rule.action})?`)) return;
      try {
        await apiDelete(rule.id);
        await reload();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [reload],
  );

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        await apiCreate({
          strategy: strategy.trim() || null,
          structure_type: structureType.trim() || null,
          rule_type: ruleType,
          threshold: Number(threshold),
          action,
          enabled: true,
          priority: Number(priority) || 100,
          description: description.trim() || null,
        });
        setStrategy("");
        setStructureType("");
        setThreshold("0.50");
        setDescription("");
        setShowForm(false);
        await reload();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [strategy, structureType, ruleType, threshold, action, priority, description, reload],
  );

  return (
    <div className="rounded-lg border border-border bg-bg-elev-1 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="t-section-display text-foreground">Position management rules</h2>
          <p className="t-meta text-muted-foreground mt-1">
            Auto-take-profit, time-based exits, and loss alerts on OPEN trades. Lower priority runs first.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-elev-2 px-3 py-1.5 text-label hover:bg-bg-elev-3"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {showForm ? "Cancel" : "Add rule"}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-label text-red-300">
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={onSubmit}
          className="mb-4 rounded-md border border-border bg-bg-elev-2 p-3 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted-foreground">Strategy (blank = all)</span>
              <input
                value={strategy}
                onChange={(e) => setStrategy(e.target.value)}
                placeholder="iron_condor_strategy or blank"
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted-foreground">Structure type (blank or * = all)</span>
              <input
                value={structureType}
                onChange={(e) => setStructureType(e.target.value)}
                placeholder="iron_condor / vertical_spread / *"
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted-foreground">Rule type</span>
              <select
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as RuleType)}
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
              >
                {RULE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted-foreground">Threshold</span>
              <input
                type="number"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted-foreground">Action</span>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value as RuleAction)}
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
              >
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="t-label text-muted-foreground">Priority (lower runs first)</span>
              <input
                type="number"
                step="1"
                min="0"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
              />
            </label>
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="t-label text-muted-foreground">Description (optional)</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-label"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-1.5 text-label text-bg-elev-1 hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create rule"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
        </div>
      ) : rules.length === 0 ? (
        <p className="text-muted-foreground text-label">
          No exit rules defined. Add one above to enable automated take-profit / time-exits / alerts.
        </p>
      ) : (
        <table className="w-full text-label">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-2 pr-2">Pri</th>
              <th className="text-left py-2 pr-2">Scope</th>
              <th className="text-left py-2 pr-2">Type</th>
              <th className="text-left py-2 pr-2">Threshold</th>
              <th className="text-left py-2 pr-2">Action</th>
              <th className="text-left py-2 pr-2">Status</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr
                key={rule.id}
                className={`border-b border-border/40 ${rule.enabled ? "" : "opacity-50"}`}
              >
                <td className="py-2 pr-2">{rule.priority}</td>
                <td className="py-2 pr-2 t-meta">
                  {rule.strategy || "any-strategy"} / {rule.structure_type || "any-structure"}
                </td>
                <td className="py-2 pr-2 t-meta">{rule.rule_type}</td>
                <td className="py-2 pr-2 tabular-nums">{rule.threshold}</td>
                <td className="py-2 pr-2 t-meta uppercase">{rule.action}</td>
                <td className="py-2 pr-2">
                  <button
                    type="button"
                    onClick={() => void onToggle(rule)}
                    className={`rounded-md px-2 py-0.5 t-meta ${rule.enabled ? "bg-emerald-500/20 text-emerald-300" : "bg-muted text-muted-foreground"}`}
                  >
                    {rule.enabled ? "enabled" : "disabled"}
                  </button>
                </td>
                <td className="py-2 pr-2 text-right">
                  <button
                    type="button"
                    onClick={() => void onDelete(rule)}
                    className="text-muted-foreground hover:text-red-400"
                    aria-label={`Delete rule ${rule.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
