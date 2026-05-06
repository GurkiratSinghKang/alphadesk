import type { IVTermPoint, SkewBlock } from "@/types";
import { fmtNumber, fmtPct } from "@/lib/intl";

export interface IVTermSkewProps {
  term: IVTermPoint[] | null;
  skew: SkewBlock | null;
}

export default function IVTermSkew({ term, skew }: IVTermSkewProps) {
  if (!term && !skew) {
    return (
      <section data-slot="iv-term-skew" className="mt-4">
        <h3 className="t-section-cap italic">IV term · skew</h3>
        <p className="mt-1 t-mono text-label u-muted">— unavailable</p>
      </section>
    );
  }
  return (
    <section data-slot="iv-term-skew" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
      {/* Term structure */}
      <div>
        {/* EOP-AUDIT 2026-05-06 / B1.4: title used to butt up against
            the bar visualization with no margin, making the section
            look like a single overlapping element. ``mb-2`` adds the
            breathing room. */}
        <h3 className="t-section-cap italic mb-2">IV term structure</h3>
        {term && term.length > 0 ? (
          <TermStrip points={term} />
        ) : (
          <p className="mt-1 t-mono text-label u-muted">— unavailable</p>
        )}
      </div>
      {/* Skew */}
      <div>
        <h3 className="t-section-cap italic">Put/call skew</h3>
        {skew ? (
          /* P2-30 (mobile fix wave-3): bump body text from text-label
             (12px) to text-body-sm (13px) so the skew table reads above
             the iOS Safari sub-pixel-shimmer threshold at 390×844. The
             prior 12px sat on the readability floor and combined with
             tabular-nums + monospace gave the visual impression of
             8-10px text per the persona-mobile-only.md audit. */
          <div className="mt-1 t-mono text-body-sm space-y-0.5">
            <div>
              25Δ put IV:{" "}
              <span className="tabular-nums">
                {skew.putIv25d ? fmtPct(skew.putIv25d, 1) : "—"}
              </span>
            </div>
            <div>
              25Δ call IV:{" "}
              <span className="tabular-nums">
                {skew.callIv25d ? fmtPct(skew.callIv25d, 1) : "—"}
              </span>
            </div>
            <div className="u-brand">
              Skew:{" "}
              {skew.skewPoints != null
                ? `${fmtNumber(skew.skewPoints, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" })}pts`
                : "—"}
            </div>
            <div className="u-muted">{skew.interpretation ?? ""}</div>
          </div>
        ) : (
          <p className="mt-1 t-mono text-label u-muted">— unavailable</p>
        )}
      </div>
    </section>
  );
}

function TermStrip({ points }: { points: IVTermPoint[] }) {
  // Round-7 / EP-7: filter to finite ``atmIv`` up-front. A single
  // missing / NaN point used to poison ``Math.max(...)`` and
  // ``Math.min(...)`` with NaN, which propagated into every bar
  // height and triggered React "Invalid value for property 'height'"
  // dev warnings. ``points[0].atmIv`` and the last-point access in
  // the front/back caption also crashed when the field was absent.
  const finite = points.filter((p) => Number.isFinite(p.atmIv));
  if (finite.length === 0) {
    return (
      <p className="mt-1 t-mono text-label u-muted">— term unavailable</p>
    );
  }
  const max = Math.max(...finite.map((p) => p.atmIv));
  const min = Math.min(...finite.map((p) => p.atmIv));
  const range = max - min || 1;
  // Round-8 / QR-02: surface absolute Y-axis bounds. Without them the
  // chart was a *purely relative* strip — 25%→26% and 25%→80% rendered
  // identically. We can't add a full SVG axis without a refactor, but
  // the min/max IV labels next to the front/back caption are a low-
  // cost way to anchor the chart magnitude.
  return (
    <figure
      role="figure"
      aria-label="Implied volatility term structure"
      className="mt-1"
    >
      {/* EOP-AUDIT 2026-05-06 / B1.4: surface the absolute IV scale.
          Pre-fix, bars were scaled relative to (max - min) only, so a
          1pt and a 60pt swing rendered identically. Stamp the high
          IV value at the top edge and low at the bottom so the user
          can read magnitude. */}
      <div className="flex items-stretch gap-2">
        <div
          aria-hidden="true"
          className="flex h-10 flex-col justify-between font-mono text-eyebrow u-muted tabular-nums"
        >
          <span data-slot="iv-term-axis-max">{fmtPct(max, 0)}</span>
          <span data-slot="iv-term-axis-min">{fmtPct(min, 0)}</span>
        </div>
        {/* Round-8 / AX-06: ``aria-hidden`` the visual chart and provide
            a sr-only data table so screen-reader users get the same
            information without parsing pixel heights. */}
        <div className="flex h-10 flex-1 items-end gap-1" aria-hidden="true">
          {finite.map((p, idx) => {
            const h = ((p.atmIv - min) / range) * 30 + 8;
            // EOP-AUDIT 2026-05-06 / B1.4: rich tooltip surfacing
            // expiry, DTE, ATM IV, and intra-strip IV vs the previous
            // bar (proxy for "vs prior expiry / earlier session" when
            // intra-day deltas aren't on the wire). When ``priorIv``
            // is on the type, prefer it; otherwise fall back to the
            // adjacent bar so the user still gets a directional cue.
            const priorIv =
              (p as IVTermPoint & { priorIv?: number | null }).priorIv ??
              (idx > 0 ? finite[idx - 1].atmIv : null);
            const ivDelta =
              priorIv != null && Number.isFinite(priorIv)
                ? p.atmIv - priorIv
                : null;
            const deltaCopy =
              ivDelta == null
                ? "no prior session"
                : `${ivDelta >= 0 ? "+" : ""}${(ivDelta * 100).toFixed(1)}pts vs prior`;
            const tooltip = `Expiry ${p.expiry} · ${p.dte} DTE · ATM IV ${fmtPct(p.atmIv, 1)} · ${deltaCopy}`;
            return (
              <div
                key={p.expiry}
                data-slot="iv-term-bar"
                title={tooltip}
                aria-label={tooltip}
                className="flex flex-col items-center gap-0.5"
              >
                <div
                  className="w-5 bg-[color:var(--brand)] rounded-sm"
                  style={{ height: `${h}px`, opacity: 0.7 }}
                />
                <span className="t-mono text-label u-muted">{p.dte}d</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* P2-30 (mobile fix wave-3): bump caption from text-label (12px)
          to text-body-sm (13px) so the IV range + front/back values stay
          above the iOS sub-pixel readability floor at 390px width. */}
      <p className="mt-1 t-mono text-body-sm u-muted">
        <span className="tabular-nums">{fmtPct(min, 0)}</span>
        <span aria-hidden="true"> – </span>
        <span className="tabular-nums">{fmtPct(max, 0)}</span>
        {" · "}
        front {fmtPct(finite[0].atmIv, 0)} → back{" "}
        {fmtPct(finite[finite.length - 1].atmIv, 0)}
      </p>
      <table className="sr-only">
        <caption>
          Implied volatility by days to expiry — front-month {fmtPct(finite[0].atmIv, 1)}{" "}
          to back-month {fmtPct(finite[finite.length - 1].atmIv, 1)}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Expiry</th>
            <th scope="col">Days to expiry</th>
            <th scope="col">ATM IV</th>
          </tr>
        </thead>
        <tbody>
          {finite.map((p) => (
            <tr key={p.expiry}>
              <td>{p.expiry}</td>
              <td>{p.dte}</td>
              <td>{fmtPct(p.atmIv, 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
