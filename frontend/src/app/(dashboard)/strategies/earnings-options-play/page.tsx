import DesignSurface from "@/components/design-v2/DesignSurface";

export type SelectionSource = "pointer" | "keyboard" | "url" | null;

export default function EarningsOptionsPlayPage() {
  return <DesignSurface page="playbook" strategyName="PEAD" />;
}
