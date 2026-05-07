"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { env } from "@/env";

type Instrument = "us_equities" | "listed_options" | "etfs" | "futures" | "crypto" | "multi_asset";

interface FormState {
  name: string;
  email: string;
  firm: string;
  role: string;
  jurisdiction: string;
  capital_band: string;
  trading_mode: string;
  instruments: Instrument[];
  note: string;
  referral: string;
  website: string;
}

const initialForm: FormState = {
  name: "",
  email: "",
  firm: "",
  role: "",
  jurisdiction: "",
  capital_band: "250k_1m",
  trading_mode: "paper_to_live",
  instruments: ["us_equities", "listed_options"],
  note: "",
  referral: "",
  website: "",
};

const instrumentOptions: Array<{ value: Instrument; label: string }> = [
  { value: "us_equities", label: "US equities" },
  { value: "listed_options", label: "Listed options" },
  { value: "etfs", label: "ETFs" },
  { value: "futures", label: "Futures" },
  { value: "crypto", label: "Crypto" },
  { value: "multi_asset", label: "Multi-asset" },
];

const inputClass =
  "h-12 w-full rounded-[8px] border border-[var(--auth-border)] bg-white/80 px-4 font-sans text-body text-[var(--auth-fg)] outline-none transition-colors placeholder:text-[var(--auth-fg-soft)] focus-visible:border-[var(--auth-primary)] focus-visible:shadow-[0_0_0_4px_rgba(15,122,93,0.15)]";
const labelClass = "font-sans text-body-sm font-medium text-[var(--auth-fg)]";
const helperClass = "font-sans text-label leading-snug text-[var(--auth-fg-muted)]";

function detailFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && typeof (item as { msg?: unknown }).msg === "string") {
          return (item as { msg: string }).msg;
        }
        return null;
      })
      .filter(Boolean);
    if (messages.length) return messages.join("; ");
  }
  return null;
}

export default function RequestAccessForm() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");

  const canSubmit = useMemo(() => {
    return (
      form.name.trim().length >= 2 &&
      form.email.includes("@") &&
      form.jurisdiction.trim().length >= 2 &&
      form.instruments.length > 0 &&
      form.note.trim().length >= 20
    );
  }, [form]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setState((current) => (current === "error" ? "idle" : current));
    setError("");
  }

  function toggleInstrument(value: Instrument) {
    setForm((current) => {
      const exists = current.instruments.includes(value);
      const next = exists
        ? current.instruments.filter((item) => item !== value)
        : [...current.instruments, value];
      return { ...current, instruments: next };
    });
    setState((current) => (current === "error" ? "idle" : current));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit || state === "loading") return;
    setState("loading");
    setError("");

    try {
      const apiBase = env.API_URL || "";
      const res = await fetch(`${apiBase}/api/v1/access-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          name: form.name.trim(),
          email: form.email.trim(),
          firm: form.firm.trim() || null,
          role: form.role.trim() || null,
          jurisdiction: form.jurisdiction.trim(),
          note: form.note.trim(),
          referral: form.referral.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(detailFromBody(body) ?? "The request could not be sent. Please try again.");
        setState("error");
        return;
      }
      setRequestId(typeof body?.request_id === "string" ? body.request_id : "");
      setState("success");
    } catch {
      setError("Could not reach the AlphaDesk API. Please try again.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="flex flex-col gap-5">
        <div className="border-b border-[var(--auth-border)] pb-5">
          <div className="mb-4 inline-flex size-11 items-center justify-center rounded-[8px] border border-[var(--auth-border-soft)] bg-[var(--auth-bg-tint)] text-[var(--auth-primary)]">
            <CheckCircle className="h-5 w-5" aria-hidden weight="regular" />
          </div>
          <p className="font-mono text-eyebrow font-semibold uppercase tracking-[0.18em] text-[var(--auth-primary)]">
            § 02 · CONFIRMATION
          </p>
          <h2 className="mt-3 font-sans text-h2 font-semibold leading-tight tracking-tight text-[var(--auth-fg)]">
            Request received
          </h2>
          <p className="mt-2 font-sans text-body-sm leading-relaxed text-[var(--auth-fg-muted)]">
            The desk reviews requests in batches — typically within one trading session. You&apos;ll get an email at the address above when access is provisioned.
          </p>
          {requestId && (
            <p className="mt-1 font-mono text-eyebrow text-[var(--auth-border-strong)]">
              Ref {requestId}
            </p>
          )}
        </div>
        <div className="grid gap-3 rounded-[8px] border border-[var(--auth-border)] bg-white/70 p-4">
          <p className="font-sans text-body-sm font-medium text-[var(--auth-fg)]">What happens next</p>
          <p className="font-sans text-body-sm leading-relaxed text-[var(--auth-fg-muted)]">
            We review the book context, trading mode, jurisdiction, and instrument set. If there is a fit, onboarding starts with paper routing and an operator walkthrough.
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={() => {
            setForm(initialForm);
            setState("idle");
            setRequestId("");
          }}
          className="h-12 rounded-[8px]"
        >
          Submit another request
        </Button>
        <Link
          href="/login"
          className="text-center font-sans text-body-sm font-medium text-[var(--auth-primary)] underline decoration-[var(--auth-primary)]/35 underline-offset-4 transition-colors hover:text-[var(--auth-primary-deeper)]"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="border-b border-[var(--auth-border)] pb-4">
        <p className="font-mono text-eyebrow font-semibold uppercase tracking-[0.18em] text-[var(--auth-primary)]">
          Access intake
        </p>
        <h2 className="mt-3 font-sans text-h2 font-semibold leading-tight tracking-tight text-[var(--auth-fg)]">
          Start your workspace request
        </h2>
        <p className="mt-2 font-sans text-body-sm leading-relaxed text-[var(--auth-fg-muted)]">
          Tell us what you trade, how you work, and where an AI review layer would help most.
        </p>
      </div>

      <div className="hidden">
        <label htmlFor="request-website">Website</label>
        <input
          id="request-website"
          name="website"
          value={form.website}
          onChange={(e) => update("website", e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="request-name" className={labelClass}>Name</label>
          <input
            id="request-name"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass}
            placeholder="Mira Patel"
            autoComplete="name"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="request-email" className={labelClass}>Work email</label>
          <input
            id="request-email"
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className={inputClass}
            placeholder="mira@fund.example"
            autoComplete="email"
            required
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="request-firm" className={labelClass}>Firm or context</label>
          <input
            id="request-firm"
            value={form.firm}
            onChange={(e) => update("firm", e.target.value)}
            className={inputClass}
            placeholder="Independent PM"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="request-role" className={labelClass}>Role</label>
          <input
            id="request-role"
            value={form.role}
            onChange={(e) => update("role", e.target.value)}
            className={inputClass}
            placeholder="Portfolio manager"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label htmlFor="request-jurisdiction" className={labelClass}>Trading jurisdiction</label>
          <input
            id="request-jurisdiction"
            value={form.jurisdiction}
            onChange={(e) => update("jurisdiction", e.target.value)}
            className={inputClass}
            placeholder="United States"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="request-capital" className={labelClass}>Approximate capital</label>
          <select
            id="request-capital"
            value={form.capital_band}
            onChange={(e) => update("capital_band", e.target.value)}
            className={inputClass}
          >
            <option value="under_250k">Under $250k</option>
            <option value="250k_1m">$250k to $1m</option>
            <option value="1m_10m">$1m to $10m</option>
            <option value="10m_50m">$10m to $50m</option>
            <option value="over_50m">Over $50m</option>
          </select>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Trading mode</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            ["paper", "Paper"],
            ["paper_to_live", "Paper to live"],
            ["live", "Live"],
          ].map(([value, label]) => (
            <label
              key={value}
            className={
                "flex min-h-11 cursor-pointer items-center justify-center rounded-[8px] border px-3 font-sans text-body-sm transition-all active:scale-[0.98] " +
                (form.trading_mode === value
                  ? "border-[var(--auth-primary)]/[0.55] bg-[var(--auth-bg-tint)] text-[var(--auth-primary-deep)]"
                  : "border-[var(--auth-border)] bg-white/70 text-[var(--auth-fg-muted)] hover:border-[var(--auth-primary)]/[0.35] hover:text-[var(--auth-fg)]")
              }
            >
              <input
                type="radio"
                name="trading_mode"
                value={value}
                checked={form.trading_mode === value}
                onChange={(e) => update("trading_mode", e.target.value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Instruments</legend>
        <div className="grid grid-cols-2 gap-2">
          {instrumentOptions.map((option) => {
            const active = form.instruments.includes(option.value);
            return (
              <label
                key={option.value}
                className={
                  "flex min-h-10 cursor-pointer items-center rounded-[8px] border px-3 font-sans text-body-sm transition-all active:scale-[0.98] " +
                  (active
                    ? "border-[var(--auth-primary)]/[0.55] bg-[var(--auth-bg-tint)] text-[var(--auth-primary-deep)]"
                    : "border-[var(--auth-border)] bg-white/70 text-[var(--auth-fg-muted)] hover:border-[var(--auth-primary)]/[0.35] hover:text-[var(--auth-fg)]")
                }
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={() => toggleInstrument(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
        <p className={helperClass}>Select every market you expect to route or research in AlphaDesk.</p>
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="request-note" className={labelClass}>Book context</label>
        <textarea
          id="request-note"
          value={form.note}
          onChange={(e) => update("note", e.target.value)}
          className="min-h-24 w-full resize-y rounded-[8px] border border-[var(--auth-border)] bg-white/80 px-4 py-3 font-sans text-body leading-normal text-[var(--auth-fg)] outline-none transition-colors placeholder:text-[var(--auth-fg-soft)] focus-visible:border-[var(--auth-primary)] focus-visible:shadow-[0_0_0_4px_rgba(15,122,93,0.15)]"
          placeholder="Describe the strategy work, execution needs, and what would make AlphaDesk useful."
          required
        />
        <p className={helperClass}>Minimum 20 characters. Do not include passwords, API keys, or account numbers.</p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="request-referral" className={labelClass}>Referral or context</label>
        <input
          id="request-referral"
          value={form.referral}
          onChange={(e) => update("referral", e.target.value)}
          className={inputClass}
          placeholder="Optional"
        />
      </div>

      {state === "error" && (
        <div
          role="alert"
          aria-live="assertive"
          className="inline-flex items-start gap-2 rounded-[8px] border border-[var(--auth-loss)]/[0.26] bg-[var(--auth-loss-soft)] px-3 py-2 font-sans text-body-sm leading-snug text-[var(--auth-loss-deep)]"
        >
          <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden weight="regular" />
          {error}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        variant="primary"
        disabled={!canSubmit || state === "loading"}
        className="h-12 rounded-[8px] disabled:bg-[var(--auth-border-soft)] disabled:text-[var(--auth-fg)] disabled:opacity-100"
      >
        {state === "loading" ? (
          <CircleNotch className="mr-2 h-4 w-4 animate-spin" aria-hidden weight="regular" />
        ) : (
          <ArrowRight className="mr-2 h-4 w-4" aria-hidden weight="regular" />
        )}
        Send request
      </Button>
    </form>
  );
}
