import { mockPush } from "../../../../__tests__/setup-mocks";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import type { EarningsSetup, EarningsSetupLeg } from "@/types";
import { SETUP_ID_TO_LABEL } from "@/lib/api";

import { RecommendedSetups } from "../_sections/RecommendedSetups";

vi.mock("@/components/options/OptionsPayoffPanel", () => ({
  default: ({ draft, title }: { draft: { comboType?: string | null } | null; title?: string }) => (
    <div data-testid="payoff-panel" data-combo={draft?.comboType ?? "none"}>
      payoff for {title}
    </div>
  ),
}));

const EXPIRY = "2026-05-16";

function makeLeg(overrides: Partial<EarningsSetupLeg> = {}): EarningsSetupLeg {
  return {
    side: "buy",
    contractType: "call",
    strike: 200,
    expiry: EXPIRY,
    qty: 1,
    mid: 1.25,
    ...overrides,
  };
}

function makeSetup(
  setupId: string,
  legs: EarningsSetupLeg[] = [makeLeg()],
  overrides: Partial<EarningsSetup> = {},
): EarningsSetup {
  return {
    setupId: setupId as EarningsSetup["setupId"],
    setupLabel: SETUP_ID_TO_LABEL[setupId] ?? null,
    legs,
    netCreditOrDebit: -2.5,
    maxProfit: 250,
    maxLoss: -250,
    breakevens: [201.25],
    popEstimate: 0.55,
    expectedValue: 12,
    riskReward: null,
    rationale: "test rationale",
    sizingKellyPct: 0.012,
    isDefinedRisk: true,
    confidence: null,
    ...overrides,
  };
}

describe("RecommendedSetups", () => {
  it("renders 3 setup cards when the recommender returns 3 setups", () => {
    const setups: EarningsSetup[] = [
      makeSetup("bull_put_spread"),
      makeSetup("iron_condor"),
      makeSetup("long_call"),
    ];

    const { getByTestId, getAllByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={setups}
        isETF={false}
        underlying={200}
      />,
    );

    expect(getByTestId("recommended-setups")).toBeInTheDocument();
    const cards = getAllByTestId("setup-card");
    expect(cards).toHaveLength(3);
    expect(cards[0].getAttribute("data-setup-id")).toBe("bull_put_spread");
    expect(cards[1].getAttribute("data-setup-id")).toBe("iron_condor");
    expect(cards[2].getAttribute("data-setup-id")).toBe("long_call");
  });

  it("caps the rendered list to the top 3 even when 4+ setups arrive", () => {
    const setups: EarningsSetup[] = [
      makeSetup("bull_put_spread"),
      makeSetup("iron_condor"),
      makeSetup("long_call"),
      makeSetup("long_put"),
    ];

    const { getAllByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={setups}
        isETF={false}
        underlying={200}
      />,
    );

    const cards = getAllByTestId("setup-card");
    expect(cards).toHaveLength(3);
    expect(cards.find((c) => c.getAttribute("data-setup-id") === "long_put")).toBeUndefined();
  });

  it("returns null when isETF=true (ETFs have no recommender coverage)", () => {
    const { container } = render(
      <RecommendedSetups
        symbol="SPY"
        setups={[makeSetup("iron_condor")]}
        isETF={true}
        underlying={500}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("returns null when setups is null or empty", () => {
    const a = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={null}
        isETF={false}
        underlying={200}
      />,
    );
    expect(a.container.firstChild).toBeNull();

    const b = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[]}
        isETF={false}
        underlying={200}
      />,
    );
    expect(b.container.firstChild).toBeNull();
  });

  it("builds a canonical /trade?legs=OCC:side:qty:limit,…&combo_type=… CTA per card", () => {
    // T8 audit P0 (2026-05-05): the trade page parses ``?legs=…&combo_type=…``;
    // a base64-JSON ``combo`` param was silently ignored, so clicking
    // "Trade this setup" landed on a blank ticket. Assert the URL shape
    // matches the format the trade page actually understands.
    const setup = makeSetup("bull_put_spread", [
      makeLeg({ side: "sell", contractType: "put", strike: 195, mid: 2.4 }),
      makeLeg({ side: "buy", contractType: "put", strike: 190, mid: 1.1 }),
    ]);

    const { getByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[setup]}
        isETF={false}
        underlying={200}
      />,
    );

    const cta = getByTestId("setup-trade-cta");
    const href = cta.getAttribute("data-href") ?? "";
    expect(href.startsWith("/trade?")).toBe(true);
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(params.get("symbol")).toBe("NVDA");
    expect(params.get("strategy")).toBe("earnings-options-play");
    // bull_put_spread → vertical_spread per the SETUP_ID_TO_COMBO_TYPE map.
    expect(params.get("combo_type")).toBe("vertical_spread");
    // OCC: NVDA + 260516 + P + 00195000  → NVDA260516P00195000.
    expect(params.get("legs")).toBe(
      "NVDA260516P00195000:sell:1:2.40,NVDA260516P00190000:buy:1:1.10",
    );
  });

  it("maps each known setup_id to the matching backend combo_type", () => {
    // Audit fix: extended the SETUP_ID_TO_COMBO_TYPE map after the
    // backend's _ALLOWED set was widened. long_call / long_put /
    // cash_secured_put / covered_call now round-trip with their own
    // combo_type so the equity gate and broker adapter classify them
    // correctly instead of falling back to per-leg notional pricing.
    const cases: Array<[string, string]> = [
      ["bull_put_spread", "vertical_spread"],
      ["bear_call_spread", "vertical_spread"],
      ["bull_call_spread", "vertical_spread"],
      ["bear_put_spread", "vertical_spread"],
      ["long_straddle", "straddle"],
      ["short_straddle", "straddle"],
      ["long_strangle", "strangle"],
      ["short_strangle", "strangle"],
      ["iron_condor", "iron_condor"],
      ["iron_butterfly", "iron_butterfly"],
      ["long_call", "long_call"],
      ["long_put", "long_put"],
      ["cash_secured_put", "cash_secured_put"],
      ["covered_call", "covered_call"],
    ];

    for (const [setupId, expectedComboType] of cases) {
      const { getByTestId, unmount } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[makeSetup(setupId)]}
          isETF={false}
          underlying={200}
        />,
      );
      const cta = getByTestId("setup-trade-cta");
      const href = cta.getAttribute("data-href") ?? "";
      const params = new URLSearchParams(href.split("?")[1] ?? "");
      expect(params.get("combo_type"), `combo_type for ${setupId}`).toBe(
        expectedComboType,
      );
      unmount();
    }
  });

  it("emits combo_type=long_call for the long_call setup_id (audit fix)", () => {
    // Audit fix: long_call is now in both the backend _ALLOWED set and
    // the frontend ALLOWED_COMBO_TYPES set. The deep-link must carry
    // combo_type=long_call so the trade page classifies the order
    // correctly instead of falling through as undefined-risk.
    const setup = makeSetup("long_call", [
      makeLeg({ side: "buy", contractType: "call", strike: 200, mid: 1.25 }),
    ]);
    const { getByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[setup]}
        isETF={false}
        underlying={200}
      />,
    );
    const href = getByTestId("setup-trade-cta").getAttribute("data-href") ?? "";
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(params.get("combo_type")).toBe("long_call");
    expect(params.get("legs")).toBe("NVDA260516C00200000:buy:1:1.25");
  });

  it("omits combo_type for setup_ids the recommender doesn't classify (e.g. 'skip')", () => {
    // 'skip' has no combo classification — explicit absence of the
    // combo_type param keeps the URL honest.
    const setup = makeSetup("not_a_real_setup", [
      makeLeg({ side: "buy", contractType: "call", strike: 200, mid: 1.25 }),
    ]);
    const { getByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[setup]}
        isETF={false}
        underlying={200}
      />,
    );
    const href = getByTestId("setup-trade-cta").getAttribute("data-href") ?? "";
    const params = new URLSearchParams(href.split("?")[1] ?? "");
    expect(params.has("combo_type")).toBe(false);
  });

  it("renders a card for setupId='skip' WITHOUT the payoff panel and without the trade CTA", () => {
    const skip = makeSetup("skip", [makeLeg()]);
    const { getByTestId, queryByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[skip]}
        isETF={false}
        underlying={200}
      />,
    );

    expect(getByTestId("setup-card")).toBeInTheDocument();
    expect(queryByTestId("payoff-panel")).toBeNull();
    expect(queryByTestId("setup-trade-cta")).toBeNull();
  });

  it("renders the section anchor id='setups'", () => {
    const { getByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[makeSetup("iron_condor")]}
        isETF={false}
        underlying={200}
      />,
    );

    expect(getByTestId("recommended-setups").getAttribute("id")).toBe("setups");
    expect(getByTestId("recommended-setups").className).toContain("scroll-mt-24");
  });

  it("renders the payoff panel for known setupIds (mocked panel receives the draft.comboType)", () => {
    const { getByTestId } = render(
      <RecommendedSetups
        symbol="NVDA"
        setups={[makeSetup("iron_condor")]}
        isETF={false}
        underlying={200}
      />,
    );

    expect(getByTestId("payoff-panel").getAttribute("data-combo")).toBe("iron_condor");
  });

  // ─── P0 audit (2026-05-06): chip + warning modal parity with EOP ──
  describe("P0 audit (2026-05-06) — confidence chip + warning modal", () => {
    beforeEach(() => {
      mockPush.mockReset();
      // base-ui's Dialog portal mounts to document.body; clean up any
      // leftover modal nodes between tests so queries don't see stale
      // dialogs.
      document
        .querySelectorAll('[data-slot="low-confidence-warning-modal"]')
        .forEach((n) => n.remove());
    });

    // base-ui's Dialog leaves the popup in the DOM with ``data-closed``
    // during the close animation; "open" means ``data-open`` is present.
    const queryModal = () =>
      document.querySelector(
        '[data-slot="low-confidence-warning-modal"][data-open]',
      );

    it("renders a confidence chip when setup.confidence is non-null", () => {
      const setup = makeSetup("bull_put_spread", undefined, { confidence: 0.72 });
      const { container } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      const chip = container.querySelector('[data-slot="confidence-chip"]');
      expect(chip).not.toBeNull();
      expect(chip!.textContent).toBe("72% conf");
      expect(chip!.className).toContain("u-brand");
    });

    it("does NOT render a confidence chip when setup.confidence is null", () => {
      const setup = makeSetup("iron_condor", undefined, { confidence: null });
      const { container } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      expect(container.querySelector('[data-slot="confidence-chip"]')).toBeNull();
    });

    it("opens warning modal and prevents navigation on directional setup with confidence < 0.50 (long call @ 0.30)", () => {
      const setup = makeSetup(
        "long_call",
        [makeLeg({ side: "buy", contractType: "call", strike: 200, mid: 1.25 })],
        { confidence: 0.30 },
      );
      const { getByTestId } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      const cta = getByTestId("setup-trade-cta") as HTMLButtonElement;
      fireEvent.click(cta);
      const modal = queryModal();
      expect(modal).not.toBeNull();
      expect(modal!.textContent).toMatch(/Low conviction directional trade/i);
      expect(modal!.textContent).toMatch(/30%/);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("does NOT open modal for iron condor at 0.30 confidence — vol-selling exempt — and navigates", () => {
      const setup = makeSetup(
        "iron_condor",
        [makeLeg({ side: "sell", contractType: "put", strike: 195, mid: 2.4 })],
        { confidence: 0.30 },
      );
      const { getByTestId } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      const cta = getByTestId("setup-trade-cta") as HTMLButtonElement;
      fireEvent.click(cta);
      expect(queryModal()).toBeNull();
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("does NOT open modal for directional setup at 0.65 confidence — above threshold — and navigates", () => {
      const setup = makeSetup(
        "long_call",
        [makeLeg({ side: "buy", contractType: "call", strike: 200, mid: 1.25 })],
        { confidence: 0.65 },
      );
      const { getByTestId } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      const cta = getByTestId("setup-trade-cta") as HTMLButtonElement;
      fireEvent.click(cta);
      expect(queryModal()).toBeNull();
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it("Override on the modal pushes the original deep-link via Next router and closes the modal", () => {
      const setup = makeSetup(
        "bull_put_spread",
        [
          makeLeg({ side: "sell", contractType: "put", strike: 195, mid: 2.4 }),
          makeLeg({ side: "buy", contractType: "put", strike: 190, mid: 1.1 }),
        ],
        { confidence: 0.20 },
      );
      const { getByTestId } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      const cta = getByTestId("setup-trade-cta") as HTMLButtonElement;
      const expectedHref = cta.getAttribute("data-href") ?? "";
      fireEvent.click(cta);
      expect(queryModal()).not.toBeNull();
      const override = document.querySelector(
        '[data-slot="low-confidence-warning-override"]',
      ) as HTMLButtonElement;
      fireEvent.click(override);
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(expectedHref);
    });

    it("Cancel on the modal closes without navigating", () => {
      const setup = makeSetup(
        "long_put",
        [makeLeg({ side: "buy", contractType: "put", strike: 200, mid: 1.5 })],
        { confidence: 0.20 },
      );
      const { getByTestId } = render(
        <RecommendedSetups
          symbol="NVDA"
          setups={[setup]}
          isETF={false}
          underlying={200}
        />,
      );
      const cta = getByTestId("setup-trade-cta") as HTMLButtonElement;
      fireEvent.click(cta);
      expect(queryModal()).not.toBeNull();
      const cancel = document.querySelector(
        '[data-slot="low-confidence-warning-cancel"]',
      ) as HTMLButtonElement;
      fireEvent.click(cancel);
      expect(queryModal()).toBeNull();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
