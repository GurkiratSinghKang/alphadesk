// _earnings/EarningsDetailPanel.tsx — stub; real impl in Task 21
import type { EarningsDetail } from "@/types";
export default function EarningsDetailPanel(props: {
  detail: EarningsDetail | null; loading: boolean; error: string | null;
  runningFull: boolean; onRunFullResearch: () => void;
}) {
  return (
    <section data-slot="earnings-detail-panel">
      {props.detail ? props.detail.symbol : props.loading ? "Loading" : "Select a symbol"}
    </section>
  );
}
