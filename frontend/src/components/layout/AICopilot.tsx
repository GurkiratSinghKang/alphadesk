"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Send, X, Sparkles, ChevronRight, Loader2 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";
import { chatWithAgent } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
  timestamp: Date;
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

export function AICopilot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedSymbol = useMarketStore((s) => s.selectedSymbol);
  const summary = usePortfolioStore((s) => s.summary);
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
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
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      const pageContext = getPageContext(pathname ?? "/", selectedSymbol);
      const contextParts = [
        pageContext,
        `Portfolio: $${summary.equity.toLocaleString()} equity, ${summary.positionsCount} positions`,
      ];

      try {
        const result = await chatWithAgent(
          text.trim(),
          selectedSymbol,
          contextParts.join(". ")
        );

        let content =
          result.message ||
          (result as unknown as { response?: string }).response ||
          "No response";
        if (/error|Error code:/i.test(content)) {
          content = "AI assistant is currently unavailable. Please try again.";
        }

        const assistantMsg: Message = {
          id: `a-${Date.now()}`,
          role: "assistant",
          content,
          suggestions: result.suggestions?.length
            ? result.suggestions
            : undefined,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content:
              "I'm having trouble connecting. Please try again in a moment.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, pathname, selectedSymbol, summary.equity, summary.positionsCount]
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
      <div
        className={cn(
          "fixed top-0 right-0 z-50 flex h-full w-full max-w-[400px] sm:w-[400px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
        role="complementary"
        aria-label="AI Copilot"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
              <Brain className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                AI Copilot
              </h2>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--profit)]" />
                {contextLabel}
              </div>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--panel)] hover:text-foreground"
            aria-label="Close AI Copilot"
          >
            <X className="h-4 w-4" />
          </button>
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
              <p className="mb-6 text-center text-xs text-muted-foreground">
                Ask me anything about your portfolio, markets, or trading
                strategies.
              </p>
              <div className="w-full space-y-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    disabled={loading}
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:opacity-50"
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
                      "rounded-lg px-3 py-2.5 text-xs leading-relaxed",
                      msg.role === "user"
                        ? "ml-8 bg-primary/10 text-foreground"
                        : "mr-2 bg-[var(--panel)] text-foreground"
                    )}
                  >
                    {msg.role === "assistant" && (
                      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-primary">
                        <Brain className="h-3 w-3" />
                        Copilot
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                    <div className="mt-1.5 text-[9px] text-muted-foreground">
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
                          className="rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[10px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
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
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-primary">
                    <Brain className="h-3 w-3" />
                    Copilot
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
              aria-label="Ask Claude a question"
              disabled={loading}
              className="min-w-0 flex-1 bg-transparent text-base sm:text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-white transition-colors hover:bg-primary/80 disabled:opacity-30"
              aria-label="Send message"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-2 text-center text-[9px] text-muted-foreground">
            <kbd className="rounded border border-[var(--border)] bg-[var(--surface)] px-1 py-0.5 font-mono text-[9px]">
              Cmd+J
            </kbd>{" "}
            to toggle
          </div>
        </div>
      </div>
    </>
  );
}
