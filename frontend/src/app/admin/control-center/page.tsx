"use client";

// Opt out of static prerender. The (dashboard) layout uses client-only
// hooks (useWs etc.) that throw outside the Providers tree; Next.js's
// build-time prerender pass tries to render this route's layout and
// crashes with "useWs must be used within Providers". force-dynamic
// makes the route render only at request time, sidestepping prerender.
export const dynamic = "force-dynamic";

import { Buildings, House, ShieldCheck } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppMindMap } from "./_components/AppMindMap";
import {
  getAdminBackendKeys,
  patchAdminBackendKeys,
  getLayoutConfig,
  patchLayoutConfig,
  triggerDeploy,
  getLastDeploy,
  type AdminBackendKey,
  type LayoutConfig,
  type LayoutSection,
  type DeployResult,
} from "@/lib/api";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

/**
 * /admin/control-center — provider-agnostic admin surface for runtime
 * configuration. Three panels:
 *
 *  1. Backend keys — rotate API keys (Anthropic, FMP, Alpaca, OpenAI,
 *     etc.) without redeploying. Backend stores them encrypted in
 *     app_config; the UI never sees plaintext after submit.
 *
 *  2. Dashboard layout — show/hide and reorder dashboard sections.
 *     Drag-handles use the HTML5 drag API (no extra dep). Persists to
 *     the same app_config table.
 *
 *  3. Push to prod — triggers the GitHub Actions deploy workflow via
 *     the /admin/control-center/deploy endpoint.
 *
 * Auth is enforced server-side: every PATCH/POST goes through
 * require_admin. A non-admin user sees 403 errors when they try to
 * mutate state. We don't bother gating the route at the Next.js
 * layout level because (a) we keep cookie-based auth state in flux
 * and (b) the surface is harmless to read for an authed user.
 */
export default function AdminControlCenterPage() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-8 md:px-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1.5">
          <p className="t-label u-brand">ADMIN / CONTROL CENTER</p>
          <h1 className="font-display text-h1 text-fg">Application control center</h1>
          <p className="t-mono text-body-sm u-muted">
            Inspect architecture, live health, state ownership, backend keys, dashboard layout,
            and deploy controls. Every write is admin-gated server-side and persists to the{" "}
            <code className="font-mono text-label">app_config</code> table or the matching
            runtime control surface.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Admin navigation">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-[color:var(--border)] bg-bg-elev-1 px-3 t-mono text-label text-fg-muted transition-colors hover:border-primary/50 hover:text-fg active:scale-[0.98]"
          >
            <House className="size-4" aria-hidden="true" />
            Dashboard
          </Link>
          <Link
            href="/symbols"
            className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-[color:var(--border)] bg-bg-elev-1 px-3 t-mono text-label text-fg-muted transition-colors hover:border-primary/50 hover:text-fg active:scale-[0.98]"
          >
            <Buildings className="size-4" aria-hidden="true" />
            Symbols
          </Link>
          <span className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-[color:var(--brand)]/40 bg-[color:var(--brand-tint)] px-3 t-mono text-label u-brand">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Admin
          </span>
        </nav>
      </header>

      <AppMindMap />
      <BackendKeysPanel />
      <LayoutConfigPanel />
      <DeployPanel />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Backend keys                                                 */
/* ──────────────────────────────────────────────────────────── */

function BackendKeysPanel() {
  const [keys, setKeys] = useState<AdminBackendKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminBackendKeys()
      .then((data) => {
        if (!cancelled) setKeys(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setOne = async (canonicalKey: string) => {
    const value = edits[canonicalKey]?.trim();
    if (!value) return;
    setSaving(true);
    try {
      const next = await patchAdminBackendKeys({ set: { [canonicalKey]: value } });
      setKeys(next);
      setEdits((prev) => ({ ...prev, [canonicalKey]: "" }));
      toast({ type: "success", message: `Updated ${canonicalKey}` });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const clearOne = async (canonicalKey: string) => {
    if (!confirm(`Clear ${canonicalKey}? The backend will fall back to env / defaults.`)) {
      return;
    }
    setSaving(true);
    try {
      const next = await patchAdminBackendKeys({ clear: [canonicalKey] });
      setKeys(next);
      toast({ type: "success", message: `Cleared ${canonicalKey}` });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Clear failed",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Backend keys" subtitle="API keys are encrypted at rest. The UI never reads plaintext after submit.">
      {loading ? (
        <p className="t-mono text-body-sm u-muted">Loading…</p>
      ) : error ? (
        <p className="t-mono text-body-sm u-loss">Error · {error}</p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)]">
          {keys.map((k) => (
            <li
              key={k.key}
              className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div>
                <p className="t-mono text-body-sm font-semibold u-brand">{k.label}</p>
                <p className="t-meta">
                  <code className="font-mono">{k.key}</code> ·{" "}
                  {k.set ? (
                    <span className="u-profit">set · {k.masked}</span>
                  ) : (
                    <span className="u-muted">not set</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  placeholder="paste new value"
                  value={edits[k.key] ?? ""}
                  onChange={(e) =>
                    setEdits((prev) => ({ ...prev, [k.key]: e.target.value }))
                  }
                  className="min-h-touch w-full rounded border border-[color:var(--border)] bg-transparent px-3 font-mono text-label text-fg sm:w-[260px]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setOne(k.key)}
                  disabled={saving || !(edits[k.key] ?? "").trim()}
                  className="min-h-touch rounded border border-[color:var(--brand)] px-3 t-mono text-label u-brand hover:bg-[color:var(--brand-tint)] disabled:opacity-50"
                >
                  Save key
                </button>
                {k.set ? (
                  <button
                    type="button"
                    onClick={() => clearOne(k.key)}
                    disabled={saving}
                    className="min-h-touch rounded border border-[color:var(--loss)]/50 px-3 t-mono text-label u-loss hover:bg-[color:var(--loss)]/10 disabled:opacity-50"
                  >
                    Clear key
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Layout config                                                */
/* ──────────────────────────────────────────────────────────── */

function LayoutConfigPanel() {
  const [config, setConfig] = useState<LayoutConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLayoutConfig()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sections = config?.dashboard_sections ?? [];

  const toggle = (id: string) => {
    if (!config) return;
    const next = sections.map((s) =>
      s.id === id ? { ...s, visible: !s.visible } : s,
    );
    setConfig({ ...config, dashboard_sections: next });
  };

  const move = (id: string, delta: number) => {
    if (!config) return;
    const idx = sections.findIndex((s) => s.id === id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    setConfig({
      ...config,
      dashboard_sections: next.map((s, i) => ({ ...s, order: i })),
    });
  };

  const dropOn = (id: string) => {
    if (!config || !dragId || dragId === id) return;
    const fromIdx = sections.findIndex((s) => s.id === dragId);
    const toIdx = sections.findIndex((s) => s.id === id);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...sections];
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    setConfig({
      ...config,
      dashboard_sections: next.map((s, i) => ({ ...s, order: i })),
    });
    setDragId(null);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const result = await patchLayoutConfig({
        dashboard_sections: config.dashboard_sections,
      });
      setConfig(result);
      // Invalidate the module-level cache in useLayoutConfig so any
      // open dashboard tab picks up the new config without a refresh.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("alphadesk:layout-config-updated"));
      }
      toast({ type: "success", message: "Layout saved" });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Dashboard layout"
      subtitle="Toggle sections to hide them from the dashboard. Drag rows or use ↑/↓ to reorder."
    >
      {loading ? (
        <p className="t-mono text-body-sm u-muted">Loading…</p>
      ) : error ? (
        <p className="t-mono text-body-sm u-loss">Error · {error}</p>
      ) : (
        <>
          <ul className="divide-y divide-[color:var(--border)]">
            {sections.map((s, idx) => (
              <LayoutSectionRow
                key={s.id}
                section={s}
                index={idx}
                total={sections.length}
                isDragSource={dragId === s.id}
                onToggle={() => toggle(s.id)}
                onMoveUp={() => move(s.id, -1)}
                onMoveDown={() => move(s.id, +1)}
                onDragStart={() => setDragId(s.id)}
                onDragEnd={() => setDragId(null)}
                onDrop={() => dropOn(s.id)}
              />
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="min-h-touch rounded border border-[color:var(--brand)] bg-[color:var(--brand-tint)] px-4 t-mono text-label u-brand disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save layout"}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

function LayoutSectionRow({
  section,
  index,
  total,
  isDragSource,
  onToggle,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  section: LayoutSection;
  index: number;
  total: number;
  isDragSource: boolean;
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-3 py-3 transition-opacity",
        isDragSource && "opacity-50",
      )}
    >
      <span aria-hidden="true" className="cursor-grab u-muted">⠿</span>
      <input
        type="checkbox"
        checked={section.visible}
        onChange={onToggle}
        aria-label={`Toggle ${section.id}`}
        className="h-5 w-5"
      />
      <span className="flex-1 font-mono text-body-sm">
        <span className={cn(section.visible ? "u-brand" : "u-muted line-through")}>
          {humanizeSectionId(section.id)}
        </span>
        <span className="ml-2 t-meta u-muted">{section.id}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label={`Move ${section.id} up`}
          className="min-h-touch rounded border border-[color:var(--border)] px-2 t-mono text-label u-muted hover:text-fg disabled:opacity-30"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label={`Move ${section.id} down`}
          className="min-h-touch rounded border border-[color:var(--border)] px-2 t-mono text-label u-muted hover:text-fg disabled:opacity-30"
        >
          ↓
        </button>
      </div>
    </li>
  );
}

function humanizeSectionId(id: string): string {
  return id
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/* ──────────────────────────────────────────────────────────── */
/*  Push to prod                                                 */
/* ──────────────────────────────────────────────────────────── */

function DeployPanel() {
  const [last, setLast] = useState<(DeployResult & { actor?: string | null }) | null>(
    null,
  );
  const [triggering, setTriggering] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    getLastDeploy()
      .then((data) => setLast(data))
      .catch(() => {});
  }, []);

  const onTrigger = async () => {
    if (!confirm("Trigger a production deploy now?")) return;
    setTriggering(true);
    try {
      const result = await triggerDeploy();
      setLast({ ...result, actor: null });
      toast({
        type: "success",
        message: result.html_url ? "Deploy triggered" : "Deploy queued",
      });
    } catch (err) {
      toast({
        type: "error",
        message: err instanceof Error ? err.message : "Trigger failed",
      });
    } finally {
      setTriggering(false);
    }
  };

  return (
    <Panel
      title="Push to prod"
      subtitle="Triggers the GitHub Actions deploy workflow on the operational branch."
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onTrigger}
          disabled={triggering}
          className="min-h-touch rounded border border-[color:var(--brand)] bg-[color:var(--brand-tint)] px-4 t-mono text-label u-brand disabled:opacity-50"
        >
          {triggering ? "Triggering…" : "▸ Push to prod"}
        </button>
        {last?.triggered_at ? (
          <p className="t-mono text-label u-muted">
            Last:{" "}
            {last.html_url ? (
              <a
                className="u-brand underline"
                href={last.html_url}
                target="_blank"
                rel="noreferrer"
              >
                {last.triggered_at}
              </a>
            ) : (
              last.triggered_at
            )}
            {last.actor ? <span className="ml-1">· by {last.actor}</span> : null}
            {last.ok === false ? <span className="ml-1 u-loss">· failed</span> : null}
          </p>
        ) : (
          <p className="t-mono text-label u-muted">No deploy triggered from this UI yet.</p>
        )}
      </div>
    </Panel>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Shared panel chrome                                          */
/* ──────────────────────────────────────────────────────────── */

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5">
      <header className="mb-3">
        <h2 className="font-display text-h3 text-fg">{title}</h2>
        <p className="mt-1 t-mono text-label u-muted">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}
