/**
 * Iter 25 — LoginForm post-login redirect honours the saved
 * `appearance.landingPage` preference.
 *
 * Prior to this iter the LoginForm hard-coded
 *   `window.location.assign("/")`
 * regardless of what the user had picked in Settings → Preferences. The
 * fix:
 *   1. GET /api/v1/user/settings after the auth POST succeeds.
 *   2. Read `appearance.landingPage`.
 *   3. Validate against the ALLOWED_LANDING_PATHS whitelist.
 *   4. Navigate to the validated path, or fall back to "/" if anything
 *      goes wrong / the path is off the whitelist.
 *
 * These tests pin the three branches:
 *   - Happy path: saved preference "/watchlists" → assign("/watchlists")
 *   - No preference → assign("/")
 *   - Malicious preference "https://evil.com" → assign("/")
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import * as api from "@/lib/api";
import LoginForm from "@/app/login/_login/LoginForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(""),
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const baseSettings: api.UserSettingsV2 = {
  default_broker_connection_id: 1,
  slippage_tolerance_bps: 5,
  default_order_qty: 1,
  fast_fill_confirms: true,
  appearance: {},
  shortcuts: null,
  feed_providers: null,
};

let originalAssign: typeof window.location.assign;
let assignSpy: ReturnType<typeof vi.fn>;

function mockFetchOk() {
  // Returned spy is unused — callers exercise auth via the real
  // submit flow, and we only need fetch to resolve "ok" so the
  // LoginForm's success path runs.
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ refresh_token: null }),
  } as unknown as Response);
}

function setupWindowLocationAssign() {
  // jsdom's window.location.assign isn't a vi.fn by default.
  originalAssign = window.location.assign;
  assignSpy = vi.fn();
  // Reassign — but window.location is a Location object whose
  // properties may be non-configurable. Replace via Object.defineProperty.
  try {
    Object.defineProperty(window.location, "assign", {
      configurable: true,
      writable: true,
      value: assignSpy,
    });
  } catch {
    // Fallback: replace the whole `location` object.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign: assignSpy },
    });
  }
}

function teardownWindowLocationAssign() {
  try {
    Object.defineProperty(window.location, "assign", {
      configurable: true,
      writable: true,
      value: originalAssign ?? (() => undefined),
    });
  } catch {
    // ignore
  }
}

async function submitForm() {
  const username = screen.getByLabelText(/email/i);
  const password = screen.getByLabelText("PASSWORD");
  fireEvent.change(username, { target: { value: "operator" } });
  fireEvent.change(password, { target: { value: "hunter2hunter2" } });
  const button = screen
    .getAllByText(/sign in/i)
    .find((el) => el.closest("button"))
    ?.closest("button");
  if (!button) throw new Error("could not find Sign in button");
  fireEvent.click(button);
}

beforeEach(() => {
  setupWindowLocationAssign();
  mockFetchOk();
  // Clean any localStorage state from lockout
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  teardownWindowLocationAssign();
});

describe("LoginForm — landing-page redirect honours saved preference", () => {
  it("navigates to /watchlists when appearance.landingPage = /watchlists", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: { landingPage: "/watchlists" },
    });

    render(<LoginForm />);
    await submitForm();

    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
    expect(assignSpy.mock.calls[0]?.[0]).toBe("/watchlists");
  });

  it("falls back to / when there is no saved preference", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: {},
    });

    render(<LoginForm />);
    await submitForm();

    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
    expect(assignSpy.mock.calls[0]?.[0]).toBe("/");
  });

  it("falls back to / when appearance is null", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: null,
    });

    render(<LoginForm />);
    await submitForm();

    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
    expect(assignSpy.mock.calls[0]?.[0]).toBe("/");
  });

  it("rejects a malicious external URL and falls back to /", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: { landingPage: "https://evil.com/phish" },
    });

    render(<LoginForm />);
    await submitForm();

    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
    // The whitelist guards against open-redirect via the saved
    // preference — anything off the whitelist resolves to "/".
    expect(assignSpy.mock.calls[0]?.[0]).toBe("/");
  });

  it("rejects an off-whitelist relative path (e.g. /admin) and falls back to /", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: { landingPage: "/admin" },
    });

    render(<LoginForm />);
    await submitForm();

    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
    expect(assignSpy.mock.calls[0]?.[0]).toBe("/");
  });

  it("falls back to / if the settings GET fails after a successful login", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockRejectedValue(new Error("network"));

    render(<LoginForm />);
    await submitForm();

    await waitFor(() => expect(assignSpy).toHaveBeenCalled());
    expect(assignSpy.mock.calls[0]?.[0]).toBe("/");
  });
});
