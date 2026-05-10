'use client';

import dynamic from "next/dynamic";
import type { AlphaDeskDesignPage } from "./AlphaDeskDesign";

const AlphaDeskDesignApp = dynamic(() => import("./AlphaDeskDesign"), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-bg" />,
});

export default function DesignSurface({
  page,
  symbol = "NVDA",
  strategyName = "Momentum & Quality",
}: {
  page: AlphaDeskDesignPage;
  symbol?: string;
  strategyName?: string;
}) {
  return (
    <div className="h-dvh min-h-dvh w-full overflow-hidden bg-bg text-fg" data-design-surface={page}>
      <AlphaDeskDesignApp initialPage={page} initialSymbol={symbol} initialStrategy={strategyName} />
    </div>
  );
}
