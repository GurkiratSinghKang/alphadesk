"use client";

import { useRef, useEffect, useState, useMemo } from "react";
import { SHORTCUT_GROUPS, type ShortcutGroup } from "@/hooks/useKeyboardShortcuts";
import {
  Globe,
  Compass,
  BarChart3,
  List,
  Zap,
  Search,
} from "lucide-react";

const GROUP_ICONS: Record<string, typeof Globe> = {
  globe: Globe,
  compass: Compass,
  chart: BarChart3,
  list: List,
  zap: Zap,
};

function KBD({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-6 rounded-md bg-[var(--panel)] border border-border/60 px-1.5 py-0.5 text-label font-mono text-foreground shadow-[0_1px_0_1px_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  );
}

function NewBadge() {
  return (
    <span className="ml-1.5 inline-flex items-center rounded-full bg-primary/15 px-1.5 py-0 text-label font-bold uppercase tracking-wider text-primary border border-primary/20">
      New
    </span>
  );
}

function GroupSection({ group, filter }: { group: ShortcutGroup; filter: string }) {
  const Icon = GROUP_ICONS[group.icon] ?? Globe;

  const filteredItems = useMemo(() => {
    if (!filter) return group.items;
    const q = filter.toLowerCase();
    return group.items.filter(
      (item) =>
        item.description.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q)
    );
  }, [group.items, filter]);

  if (filteredItems.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-primary/10">
          <Icon className="h-3 w-3 text-primary" />
        </div>
        <h3 className="text-label font-semibold uppercase tracking-wider text-muted-foreground">
          {group.name}
        </h3>
      </div>
      <div className="space-y-1">
        {filteredItems.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-md px-2 py-2 sm:py-1.5 hover:bg-accent/20 transition-colors"
          >
            <span className="text-sm sm:text-body-sm text-muted-foreground">
              {item.description}
              {item.isNew && <NewBadge />}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {item.key.split(/(\+|\s)/).filter(k => k !== "+" && k.trim()).map((k, i) => (
                <span key={i} className="flex items-center gap-0.5">
                  {i > 0 && (
                    <span className="text-label text-muted-foreground/50 mx-0.5">
                      {item.key.includes("+") ? "+" : "then"}
                    </span>
                  )}
                  <KBD>{k.trim()}</KBD>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    // Focus the search input on mount
    searchRef.current?.focus();
  }, []);

  const visibleGroups = useMemo(() => {
    if (!filter) return SHORTCUT_GROUPS;
    const q = filter.toLowerCase();
    return SHORTCUT_GROUPS.filter((g) =>
      g.items.some(
        (item) =>
          item.description.toLowerCase().includes(q) ||
          item.key.toLowerCase().includes(q)
      )
    );
  }, [filter]);

  // Wave 32 persona-6 #4: the global keyboard hook early-returns when an
  // INPUT is focused, so Esc was swallowed once the auto-focused filter
  // input received focus. A local capture-phase keydown handler closes the
  // overlay before propagation and stops the event so the global hook's
  // input-guard never has a chance to ignore it.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className="w-[calc(100vw-1rem)] sm:w-full max-w-[640px] max-h-[88vh] sm:max-h-[80vh] flex flex-col rounded-xl border border-border bg-[var(--bg-card)] shadow-2xl shadow-black/40 outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 gap-3">
          <h2 className="text-base font-semibold text-foreground">Keyboard Shortcuts</h2>
          <div className="hidden sm:flex items-center gap-1 text-label text-muted-foreground">
            Press <KBD>Esc</KBD> to close
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sm:hidden flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors -mr-2"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        {/* Search filter */}
        <div className="px-4 sm:px-6 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Filter shortcuts..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                // Defensive: belt-and-suspenders for the parent capture; some
                // browsers fire keydown on the input before the parent. Either
                // path closes the overlay safely.
                if (e.key === "Escape") {
                  e.stopPropagation();
                  e.preventDefault();
                  onClose();
                }
              }}
              className="w-full h-10 sm:h-8 rounded-lg border border-border bg-background pl-8 pr-3 text-base sm:text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Shortcut groups */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-5 scrollbar-thin">
          {visibleGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Search className="h-5 w-5 mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No shortcuts match &ldquo;{filter}&rdquo;</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {visibleGroups.map((group) => (
                <GroupSection key={group.name} group={group} filter={filter} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 sm:px-6 py-3">
          <p className="text-label text-muted-foreground/60">
            Customize bindings in localStorage key &quot;alphadesk:keybindings&quot;
          </p>
        </div>
      </div>
    </div>
  );
}
