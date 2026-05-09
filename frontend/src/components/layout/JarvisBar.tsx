"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkle } from "@phosphor-icons/react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useControls } from "@/hooks/useControls";
import { useJarvisStore } from "@/stores/jarvis";
import type { ControlSpec } from "@/lib/mocks";
import { cn } from "@/lib/utils";

/**
 * JarvisBar — ⌘⇧J conversational command palette
 * ──────────────────────────────────────────────
 * v2 redesign — UI scaffold for the application-wide command bar
 * called out in v2-plan §1.6 (the "Jarvis" frame). Phase 0 ships
 * fuzzy-search-only against MOCK_CONTROLS — Phase 2 (B.7 backend)
 * adds Anthropic-backed intent parsing + dry-run + audit preview +
 * typed-confirm execution.
 *
 * Distinct from the existing ⌘K CommandPalette (which navigates to
 * pages and symbols). Jarvis is conversational — the user types a
 * sentence, the system surfaces matching ControlModule(s) on Admin
 * with a "Highlight on Admin" deep-link.
 *
 * Phase 0 behavior:
 *   - ⌘⇧J opens the modal (focus traps via Dialog).
 *   - Free-text input filters MOCK_CONTROLS by name + desc + envVar.
 *   - Top 5 matches show as preview cards.
 *   - Click → navigates to /admin/control-center?focus={id}.
 *   - Esc closes; Enter on the first result triggers click.
 *
 * NO action execution at this stage — the destructive path requires
 * the backend B.7 parser + DangerConfirm flow which Phase 2 wires.
 */
const PLACEHOLDER_HINTS = [
  "halt trades on NVDA",
  "rotate Anthropic key",
  "pause research agent",
  "show failing pipeline stages",
  "deploy frontend to staging",
  "set sector cap to 30%",
];

export default function JarvisBar() {
  const router = useRouter();
  const open = useJarvisStore((s) => s.open);
  const query = useJarvisStore((s) => s.query);
  const setOpen = useJarvisStore((s) => s.setOpen);
  const setQuery = useJarvisStore((s) => s.setQuery);
  const reset = useJarvisStore((s) => s.reset);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Rotate placeholder hints so the prompt feels alive without
  // animating. Resets to a fresh hint every time the modal opens.
  const placeholderRef = React.useRef(0);
  const [placeholder, setPlaceholder] = React.useState(PLACEHOLDER_HINTS[0]);
  React.useEffect(() => {
    if (open) {
      placeholderRef.current =
        (placeholderRef.current + 1) % PLACEHOLDER_HINTS.length;
      setPlaceholder(PLACEHOLDER_HINTS[placeholderRef.current]);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // Phase 0 fuzzy search via useControls. The hook's `select` runs
  // a memoized filter — we don't re-derive in here.
  const { data: matches } = useControls({ query });
  const top = React.useMemo(
    () => (matches ?? []).slice(0, 5),
    [matches],
  );

  const handlePick = React.useCallback(
    (control: ControlSpec) => {
      reset();
      router.push(`/admin/control-center?focus=${control.id}`);
    },
    [reset, router],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && top.length > 0) {
        event.preventDefault();
        handlePick(top[0]);
      }
    },
    [handlePick, top],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-slot="jarvis-bar"
        className="max-w-[580px] border-brand/40 bg-bg-card p-0 gap-0"
      >
        {/* DialogTitle is required for a11y; visually hidden but read by SR. */}
        <DialogTitle className="sr-only">Command bar</DialogTitle>
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-hair">
          <Sparkle className="h-4 w-4 text-brand" weight="fill" />
          <span className="text-eyebrow font-semibold uppercase tracking-[0.12em] text-brand">
            Find control
          </span>
          <kbd className="ml-auto rounded-sm border border-border-hair bg-bg-elev-1 px-2 py-0.5 text-eyebrow text-fg-muted">
            ⌘⇧J
          </kbd>
        </div>
        <div className="px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`e.g. ${placeholder}`}
            autoComplete="off"
            spellCheck={false}
            aria-label="Search controls or describe an action"
            className="w-full bg-transparent border-0 text-h3 font-display italic text-fg placeholder:text-fg-hint focus:outline-none"
          />
        </div>
        <ul role="listbox" className="border-t border-border-hair max-h-[360px] overflow-y-auto">
          {top.length === 0 ? (
            <li className="px-4 py-6 text-body-sm text-fg-muted">
              {query.trim().length > 0 ? (
                <>No matching control. Try a category like &quot;risk&quot; or &quot;pipeline&quot;.</>
              ) : (
                <>Type a control name or describe an action. Press Enter to jump to the matching module on Admin.</>
              )}
            </li>
          ) : (
            top.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === 0}
                className={cn(
                  "border-b last:border-b-0 border-border-hair",
                )}
              >
                <button
                  type="button"
                  onClick={() => handlePick(c)}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:bg-bg-elev-1 transition-colors"
                >
                  <span className="t-label uppercase shrink-0 mt-0.5 text-brand">
                    {c.category}
                  </span>
                  <span className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-body font-medium text-fg truncate">
                      {c.name}
                      {c.envVar && (
                        <span className="ml-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                          · {c.envVar}
                        </span>
                      )}
                    </span>
                    <span className="text-body-sm text-fg-muted line-clamp-1">
                      {c.desc}
                    </span>
                  </span>
                  <span className="shrink-0 text-eyebrow uppercase tracking-[0.08em] text-fg-muted">
                    Highlight →
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <footer className="border-t border-border-hair px-4 py-2 text-eyebrow uppercase tracking-[0.08em] text-fg-muted flex items-center justify-between">
          <span>Phase 0 · fuzzy search</span>
          <span>Phase 2 will add intent parsing + dry-run.</span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
