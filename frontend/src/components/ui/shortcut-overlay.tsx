"use client";

import { useRef, useEffect } from "react";
import { SHORTCUT_GROUPS } from "@/hooks/useKeyboardShortcuts";

function KBD({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] rounded bg-[var(--panel)] border border-border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
      {children}
    </kbd>
  );
}

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.focus(); }, []);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className="w-full max-w-[600px] rounded-xl border border-border bg-[var(--surface)] p-6 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            Press <KBD>Esc</KBD> to close
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.name}>
              <h3 className="text-label mb-3">{group.name}</h3>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-muted-foreground">{item.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {item.key.split(" ").map((k, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && <span className="text-[10px] text-muted-foreground mx-0.5">then</span>}
                          <KBD>{k}</KBD>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-[11px] text-[#555]">
          Customize bindings in localStorage key &quot;alphadesk:keybindings&quot;
        </p>
      </div>
    </div>
  );
}
