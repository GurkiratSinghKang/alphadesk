import type { IVTermPoint, SkewBlock } from "@/types";

export interface IVTermSkewProps {
  term: IVTermPoint[] | null;
  skew: SkewBlock | null;
}

export default function IVTermSkew({ term, skew }: IVTermSkewProps) {
  if (!term && !skew) {
    return (
      <section data-slot="iv-term-skew" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">IV term · skew</h3>
        <p className="mt-1 t-mono text-[12px] u-muted">— unavailable</p>
      </section>
    );
  }
  return (
    <section data-slot="iv-term-skew" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
      {/* Term structure */}
      <div>
        <h3 className="t-display-section italic text-[13px]">IV term structure</h3>
        {term && term.length > 0 ? (
          <TermStrip points={term} />
        ) : (
          <p className="mt-1 t-mono text-[12px] u-muted">— unavailable</p>
        )}
      </div>
      {/* Skew */}
      <div>
        <h3 className="t-display-section italic text-[13px]">Put/call skew</h3>
        {skew ? (
          <div className="mt-1 t-mono text-[12px] space-y-0.5">
            <div>
              25Δ put IV:{" "}
              <span className="tabular-nums">
                {skew.putIv25d ? (skew.putIv25d * 100).toFixed(1) + "%" : "—"}
              </span>
            </div>
            <div>
              25Δ call IV:{" "}
              <span className="tabular-nums">
                {skew.callIv25d ? (skew.callIv25d * 100).toFixed(1) + "%" : "—"}
              </span>
            </div>
            <div className="u-brand">
              Skew:{" "}
              {skew.skewPoints != null
                ? `${skew.skewPoints >= 0 ? "+" : ""}${skew.skewPoints.toFixed(1)}pts`
                : "—"}
            </div>
            <div className="u-muted">{skew.interpretation ?? ""}</div>
          </div>
        ) : (
          <p className="mt-1 t-mono text-[12px] u-muted">— unavailable</p>
        )}
      </div>
    </section>
  );
}

function TermStrip({ points }: { points: IVTermPoint[] }) {
  const max = Math.max(...points.map((p) => p.atmIv));
  const min = Math.min(...points.map((p) => p.atmIv));
  const range = max - min || 1;
  return (
    <div className="mt-1">
      <div className="flex h-10 items-end gap-1">
        {points.map((p) => {
          const h = ((p.atmIv - min) / range) * 30 + 8;
          return (
            <div
              key={p.expiry}
              title={`${p.expiry}: ${(p.atmIv * 100).toFixed(1)}%`}
              className="flex flex-col items-center gap-0.5"
            >
              <div
                className="w-5 bg-[color:var(--brand)] rounded-sm"
                style={{ height: `${h}px`, opacity: 0.7 }}
              />
              <span className="t-mono text-[10px] u-muted">{p.dte}d</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 t-mono text-[11px] u-muted">
        front {(points[0].atmIv * 100).toFixed(0)}% → back{" "}
        {(points[points.length - 1].atmIv * 100).toFixed(0)}%
      </p>
    </div>
  );
}
