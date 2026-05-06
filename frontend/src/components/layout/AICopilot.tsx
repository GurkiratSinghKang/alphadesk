"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Send, X, Sparkles, ChevronRight, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { chatWithAgent } from "@/lib/api";
import { safeGetItem, safeSetItem } from "@/lib/storage";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  provenance?: string;
  timestamp: Date;
}

// Round 7 Fix 6 (P131): persist the last N messages + conversation_id
// so an accidental refresh (or a session-expiry redirect) doesn't
// vaporise a long chat thread. 50 matches the backend's per-conversation
// history cap and keeps the localStorage payload reasonable (~50 * 1KB).
const AICOPILOT_STORAGE_KEY = "alphadesk.aicopilot";
const AICOPILOT_MAX_PERSISTED_MESSAGES = 50;

interface PersistedCopilotState {
  conversationId: string | null;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    suggestions?: string[];
    provenance?: string;
    // Dates don't survive JSON.stringify. Round-trip as epoch ms.
    timestamp: number;
  }[];
}

function loadPersistedState(): PersistedCopilotState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = safeGetItem(AICOPILOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedCopilotState;
    if (!parsed || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

const QUICK_PROMPTS = [
  "What should I watch today?",
  "Analyze my portfolio risk",
  "How are my strategies performing?",
  "What's the market outlook?",
  "Suggest a hedge for my positions",
];

function getPageContext(pathname: string, symbol: string): string {
  if (pathname === "/") return "User is viewing portfolio dashboard";
  if (pathname === "/trade") return `User is viewing ${symbol} chart`;
  if (pathname === "/analytics") return "User is reviewing analytics";
  if (pathname === "/alerts") return "User is managing alerts";
  if (pathname === "/pipeline") return "User is viewing pipeline";
  if (pathname === "/reports") return "User is viewing reports";
  if (pathname.startsWith("/strategies/")) {
    const id = pathname.split("/strategies/")[1];
    return `User is viewing ${id?.toUpperCase()} strategy detail`;
  }
  return `User is on ${pathname}`;
}

function formatDataFreshness(timestamp: unknown): string {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return "quote unavailable";
  const ms = numeric > 1e12 ? numeric : numeric * 1000;
  const ageSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (ageSec < 60) return `quote ${Math.max(1, ageSec)}s old`;
  if (ageSec < 3600) return `quote ${Math.round(ageSec / 60)}m old`;
  return `quote ${(ageSec / 3600).toFixed(1)}h old`;
}

function buildCopilotProvenance({
  symbol,
  quoteTimestamp,
  brokerDegraded,
  portfolioSource,
  positionsCount,
}: {
  symbol: string;
  quoteTimestamp: unknown;
  brokerDegraded: boolean;
  portfolioSource?: string | null;
  positionsCount: number;
}) {
  const dataMode = brokerDegraded ? "fallback/demo data" : portfolioSource ? `${portfolioSource} data` : "broker data unavailable";
  return `${symbol} · ${formatDataFreshness(quoteTimestamp)} · ${dataMode} · ${positionsCount} position${positionsCount === 1 ? "" : "s"} · analysis only`;
}

export function AICopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // Round 7 Fix 6 (P131): retain the backend conversation_id so every
  // subsequent /agents/chat call stitches onto the same server-side
  // history. Null means "start a fresh thread on the next send".
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const selectedQuote = useMarketStore((s) => s.quotes[s.selectedSymbol]);
  const summary = usePortfolioStore((s) => s.summary);
  const brokerDegraded = usePortfolioStore((s) => s.brokerDegraded);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Track whether we've finished the initial load so the save effect
  // doesn't race with the load effect on first mount and write an
  // empty array over a persisted thread.
  const hydrated = useRef(false);

  // ── Round 7 Fix 6 (P131): load persisted thread on mount ──
  useEffect(() => {
    const persisted = loadPersistedState();
    if (persisted) {
      setConversationId(persisted.conversationId ?? null);
      setMessages(
        persisted.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          suggestions: m.suggestions,
          provenance: m.provenance,
          // Dates don't survive JSON; rehydrate from the epoch ms.
          timestamp: new Date(m.timestamp),
        })),
      );
    }
    hydrated.current = true;
  }, []);

  // ── Round 7 Fix 6 (P131): persist messages + conversation_id ──
  // Save on every change so a hard crash / refresh / tab close doesn't
  // drop the thread. Cheap — we only persist the most recent N messages
  // and the payload is bounded.
  useEffect(() => {
    if (!hydrated.current) return; // avoid clobbering load-effect on mount
    if (typeof window === "undefined") return;
    try {
      const toPersist: PersistedCopilotState = {
        conversationId,
        messages: messages
          .slice(-AICOPILOT_MAX_PERSISTED_MESSAGES)
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            suggestions: m.suggestions,
            provenance: m.provenance,
            timestamp: m.timestamp.getTime(),
          })),
      };
      safeSetItem(AICOPILOT_STORAGE_KEY, JSON.stringify(toPersist));
    } catch {
      // quota / serialisation failure — non-fatal, the thread still
      // lives in React state for the current session.
    }
  }, [messages, conversationId]);

  // Cmd+J / Ctrl+J to toggle. The local keydown handler covers the case
  // where the user has focus on an INPUT (the global `useKeyboardShortcuts`
  // hook early-returns on inputs), and the `alphadesk:shortcut` listener
  // covers the case where the global hook dispatched `copilot:toggle`
  // because the user pressed Ctrl+J via the rebindable global path
  // (Wave 32 persona-6 #3 — previously this event was dispatched into
  // the void with no listener).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        const target = e.target as HTMLElement | null;
        const editing =
          target?.tagName === "INPUT" ||
          target?.tagName === "TEXTAREA" ||
          target?.isContentEditable;
        if (!editing) return;
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const onShortcut = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === "copilot:toggle") {
        setOpen((o) => !o);
      }
    };
    window.addEventListener("alphadesk:shortcut", onShortcut);
    return () => window.removeEventListener("alphadesk:shortcut", onShortcut);
  }, []);

  // Modal semantics: remember the trigger/focused element, focus the composer
  // on open, trap Tab inside the panel, close on Escape, then restore focus.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setTimeout(() => inputRef.current?.focus(), 350);
      return undefined;
    }
    restoreFocusRef.current?.focus();
    restoreFocusRef.current = null;
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: new Date(),
      };
      // Round-27 / persona-F P1: cap in-memory history at the same
      // bound as the persisted slice. Pre-fix the persisted state was
      // capped at 50 (line 123) but the in-memory ``messages`` state
      // grew unbounded — a heavy day with hundreds of turns retained
      // every Message + Date object in heap. Mirror the cap here so
      // RAM doesn't drift over an 8h trading session.
      setMessages((prev) =>
        [...prev, userMsg].slice(-AICOPILOT_MAX_PERSISTED_MESSAGES),
      );
      setInput("");
      setLoading(true);

      const pageContext = getPageContext(pathname ?? "/", selectedSymbol);
      const provenance = buildCopilotProvenance({
        symbol: selectedSymbol,
        quoteTimestamp: selectedQuote?.timestamp,
        brokerDegraded,
        portfolioSource: summary.source,
        positionsCount: summary.positionsCount,
      });
      const contextParts = [
        pageContext,
        `Portfolio: $${summary.equity.toLocaleString()} equity, ${summary.positionsCount} positions`,
        `Data provenance: ${provenance}`,
      ];

      try {
        const result = await chatWithAgent(
          text.trim(),
          selectedSymbol,
          contextParts.join(". "),
          // Round 7 Fix 6 (P131): pass the stitched conversation_id so
          // the backend appends to the existing Redis-cached history
          // instead of spawning a new thread every turn.
          conversationId ?? undefined,
        );

        let content =
          result.message ||
          (result as unknown as { response?: string }).response ||
          "No response";
        if (/error|Error code:/i.test(content)) {
          content = "AI is offline. Check `/pipeline` for upstream status.";
        }

        // Capture the conversation_id on first-ever response. The backend
        // echoes the same id on subsequent turns so we can fire-and-
        // forget after that, but storing every time is cheap and tolerant
        // of a server-side id rotation.
        if (result.conversation_id) {
          setConversationId(result.conversation_id);
        }

        const assistantMsg: Message = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content,
          suggestions: result.suggestions?.length
            ? result.suggestions
            : undefined,
          provenance,
          timestamp: new Date(),
        };
        setMessages((prev) =>
          [...prev, assistantMsg].slice(-AICOPILOT_MAX_PERSISTED_MESSAGES),
        );
      } catch {
        setMessages((prev) =>
          [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant" as const,
              content:
                "Lost the connection to the AI. The desk's pipeline retries automatically — check status at `/pipeline`.",
              provenance: buildCopilotProvenance({
                symbol: selectedSymbol,
                quoteTimestamp: selectedQuote?.timestamp,
                brokerDegraded: true,
                portfolioSource: summary.source,
                positionsCount: summary.positionsCount,
              }),
              timestamp: new Date(),
            },
          ].slice(-AICOPILOT_MAX_PERSISTED_MESSAGES),
        );
      } finally {
        setLoading(false);
      }
    },
    [
      loading,
      pathname,
      selectedSymbol,
      summary.equity,
      summary.positionsCount,
      summary.source,
      selectedQuote?.timestamp,
      brokerDegraded,
      conversationId,
    ]
  );

  const handleSend = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

  const contextLabel =
    pathname === "/trade" ? `Viewing: ${selectedSymbol}` : pathname === "/" ? "Dashboard" : pathname?.replace("/", "").replace(/^\w/, (c) => c.toUpperCase()) ?? "Dashboard";

  return (
    <>
      {/* Backdrop overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      {open && (
      <div
        ref={panelRef}
        className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[400px] sm:w-[400px] flex-col border-l border-[var(--border)] bg-[var(--bg-card)] shadow-2xl transition-transform duration-300 ease-in-out"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-copilot-title"
        aria-label="AI Copilot"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
              <Brain className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 id="ai-copilot-title" className="text-sm font-semibold text-foreground">
                AI Copilot
              </h2>
              <div className="flex items-center gap-1.5 text-label text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
                {contextLabel}
              </div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--panel)] hover:text-foreground sm:min-h-8 sm:min-w-8"
            aria-label="Close AI Copilot"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-[var(--border)] bg-amber/10 px-4 py-3 text-label leading-relaxed text-amber">
          <p className="font-semibold uppercase tracking-wide">Advice boundary</p>
          <p className="mt-1">
            Copilot can summarize data and suggest checks. It cannot send orders; verify quote, strategy, size, and ticket inputs yourself.
          </p>
        </div>

        {/* Messages area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            /* Empty state with quick prompts */
            <div className="flex h-full flex-col items-center justify-center px-2">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <p className="mb-1 text-sm font-medium text-foreground">
                How can I help?
              </p>
              <p className="mb-6 text-center text-label text-muted-foreground">
                Ask me anything about your portfolio, markets, or trading
                strategies.
              </p>
              <div className="w-full space-y-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    disabled={loading}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-left text-label text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
                  >
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span>{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message list */
            <div className="space-y-3">
              {messages.map((msg) => (
                <div key={msg.id}>
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2.5 text-label leading-relaxed",
                      msg.role === "user"
                        ? "ml-8 bg-primary/10 text-foreground"
                        : "mr-2 bg-[var(--panel)] text-foreground"
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-label font-medium text-primary">
                        <Brain className="h-3 w-3" />
                        Copilot
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.role === "assistant" && msg.provenance ? (
                      <div className="mt-2 rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-2 py-1.5 font-mono text-label leading-snug text-muted-foreground">
                        {msg.provenance}
                      </div>
                    ) : null}
                    <div className="mt-1.5 text-label text-muted-foreground">
                      {msg.timestamp.toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </div>
                  </div>
                  {/* Suggestion pills */}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mr-2 mt-1.5 flex flex-wrap gap-1.5">
                      {msg.suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => sendMessage(s)}
                          disabled={loading}
                          className="min-h-9 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-label text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="mr-2 rounded-lg bg-[var(--panel)] px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-label font-medium text-primary">
                    <Brain className="h-3 w-3" />
                    Copilot
                  </div>
                  <div className="flex items-center gap-2 text-label text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-[var(--border)] p-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask anything..."
              /* BUG-023 — WCAG 4.1.2: placeholder is not an accessible name.
                 Explicit aria-label so screen readers announce the field. */
              aria-label="Ask the AI a question"
              disabled={loading}
              className="min-w-0 flex-1 bg-transparent text-base sm:text-label text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-30 sm:min-h-8 sm:min-w-8"
              aria-label="Send message"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-2 text-center text-label text-muted-foreground">
            <kbd className="rounded border border-[var(--border)] bg-[var(--bg-card)] px-1 py-0.5 font-mono text-label">
              Cmd+J
            </kbd>{" "}
            to toggle
          </div>
        </div>
      </div>
      )}
    </>
  );
}
