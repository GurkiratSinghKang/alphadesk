"use client";

import * as React from "react";
import { MagnifyingGlass, ArrowRight } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { MOCK_CONTROLS, type ControlSpec } from "@/lib/mocks/controls";

/**
 * AdminCommandBar
 * ────────────────
 * v2-plan §1.6 — the conversational command bar. Sticky strip below the
 * identity band; opens via ⌘⇧J or click.
 *
 * Phase 0 behavior:
 *   - Type natural language ("halt trades on NVDA", "rotate AI key")
 *   - Token-overlap fuzzy match against control name + desc + envVar
 *   - Render top 5 matches with category badge + critical pill
 *   - Click result → scroll to control's category section + flash highlight
 *
 * Backend B.1 wires actual dispatch — until then, "execute" buttons render
 * a non-destructive proposal/preview (DangerConfirm-shaped, no real action).
 */
export default function AdminCommandBar() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // ⌘⇧J / Ctrl+Shift+J opens the bar and focuses the input.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "j") {
        e.preventDefault();
        setOpen((v) => !v);
        // Focus runs after the input renders.
        queueMicrotask(() => inputRef.current?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const matches = React.useMemo(() => {
    if (!query.trim()) return [];
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = MOCK_CONTROLS.map((c) => {
      const haystack = `${c.name} ${c.desc} ${c.envVar ?? ""} ${c.category}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) score += 2;
        if (c.name.toLowerCase().includes(t)) score += 1;
      }
      return { c, score };
    })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    return scored.map((m) => m.c);
  }, [query]);

  function jumpTo(control: ControlSpec) {
    setOpen(false);
    setQuery("");
    if (typeof window === "undefined") return;
    const id = `admin-cat-${control.category}`;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Brief flash highlight on the target category section.
    el?.classList.add("admin-cat-flash");
    window.setTimeout(() => el?.classList.remove("admin-cat-flash"), 1500);
  }

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-4",
        "bg-bg/85 backdrop-blur-md border-b border-border-hair",
      )}
    >
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          queueMicrotask(() => inputRef.current?.focus());
        }}
        className={cn(
          "w-full flex items-center gap-3 rounded-md border border-border-hair bg-bg-elev-1 px-3 py-2",
          "text-left transition-colors hover:border-brand/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
        aria-expanded={open}
        aria-controls="admin-command-results"
      >
        <MagnifyingGlass className="size-4 text-fg-muted" />
        <span className="flex-1 font-display italic text-body text-fg-muted">
          Find a control · &ldquo;halt trades on NVDA&rdquo; · &ldquo;rotate AI key&rdquo; · &ldquo;pause research&rdquo;
        </span>
        <kbd className="t-mono text-eyebrow text-fg-hint border border-border-hair rounded-sm px-1.5 py-0.5 uppercase tracking-[0.08em]">
          ⌘ ⇧ J
        </kbd>
      </button>

      {open && (
        <div
          id="admin-command-results"
          className="mt-2 rounded-md border border-border bg-bg-elev-2 shadow-2 overflow-hidden"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-hair">
            <MagnifyingGlass className="size-4 text-brand" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a control…"
              className="flex-1 bg-transparent border-0 outline-none font-mono text-body text-fg placeholder:text-fg-hint"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                }
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  jumpTo(matches[0]);
                }
              }}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="t-mono text-eyebrow text-fg-muted uppercase tracking-[0.08em] hover:text-fg"
            >
              esc
            </button>
          </div>

          {!query.trim() ? (
            <div className="px-4 py-6 text-center">
              <p className="font-display italic text-body text-fg-muted">
                Type what you want to do.
              </p>
              <p className="mt-1 t-mono text-eyebrow text-fg-hint uppercase tracking-[0.08em]">
                AI key · trade halt · pipeline · AI research · risk gate · feature flag
              </p>
            </div>
          ) : matches.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="font-display italic text-body text-fg-muted">
                No control matches &ldquo;{query}&rdquo;.
              </p>
              <p className="mt-1 t-mono text-eyebrow text-fg-hint uppercase tracking-[0.08em]">
                Backend B.1 will fall back to natural-language intent parsing.
              </p>
            </div>
          ) : (
            <ul role="listbox" className="divide-y divide-border-hair max-h-[320px] overflow-y-auto">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => jumpTo(c)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <span
                      className={cn(
                        "shrink-0 inline-flex items-center justify-center text-eyebrow font-semibold uppercase tracking-[0.08em] rounded-sm border px-1.5 py-0.5",
                        c.critical
                          ? "border-loss/40 bg-tint-down-1 text-loss"
                          : "border-brand/30 bg-tint-brand-1 text-brand",
                      )}
                    >
                      {c.category}
                    </span>
                    <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="text-body text-fg font-medium truncate">{c.name}</span>
                      <span className="font-display italic text-body-sm text-fg-muted truncate">
                        {c.desc}
                      </span>
                    </span>
                    <ArrowRight className="size-4 text-fg-muted shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="px-3 py-1.5 border-t border-border-hair flex items-center justify-between t-mono text-eyebrow text-fg-hint uppercase tracking-[0.08em]">
            <span>↵ open · esc close</span>
            <span>matches scroll to category section</span>
          </div>
        </div>
      )}

      {/* Plain inline <style> — `style jsx` requires the styled-jsx
        * runtime, which Next 16's RSC pipeline doesn't ship with the
        * dashboard chunk. Globals.css would be cleaner long-term but
        * an inline tag keeps the animation co-located with the only
        * site that ever triggers it. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `.admin-cat-flash{animation:adminCatFlash 1.5s ease-out}@keyframes adminCatFlash{0%{background:var(--tint-brand-2)}100%{background:transparent}}`,
        }}
      />
    </div>
  );
}
