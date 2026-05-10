// 2026-05-10 (honest empty-state): previously passed `strategyName="PEAD"`
// to DesignSurface, which made the design's playbook claim this slug
// IS the PEAD strategy. They're different concepts (this slug is the
// earnings-options play, not Post-Earnings Announcement Drift). Pass
// the actual slug so the playbook does a real registry lookup and
// either renders the live `/api/v1/strategies` row or falls through
// to "NOT REGISTERED" instead of inventing a different strategy's identity.
import DesignSurface from "@/components/design-v2/DesignSurface";

export type SelectionSource = "pointer" | "keyboard" | "url" | null;

export default function EarningsOptionsPlayPage() {
  return <DesignSurface page="playbook" strategyName="earnings-options-play" />;
}
