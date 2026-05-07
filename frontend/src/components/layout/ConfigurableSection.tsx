"use client";

import { useSectionConfig } from "@/hooks/useLayoutConfig";

/**
 * ConfigurableSection — opt-in visibility wrapper driven by the admin
 * Control Center's layout config. Returns ``null`` when the matching
 * section ID is marked ``visible: false`` so the dashboard skips it
 * entirely (no DOM, no measurement, no expensive subtree).
 *
 * Order is intentionally NOT applied here — repositioning a section
 * relative to siblings requires the parent grid to read the order
 * field. For this v1 the parent reads it via the same hook (see
 * frontend/src/app/(dashboard)/page.tsx). When the admin rearranges
 * sections they need to be siblings inside an order-aware container.
 *
 * Default behaviour when the layout config has not loaded (or fetch
 * failed): render the children. Better to show too much than to blank
 * the page on a transient backend outage.
 */
export function ConfigurableSection({
  id,
  children,
  applyOrder = false,
}: {
  id: string;
  children: React.ReactNode;
  applyOrder?: boolean;
}) {
  const section = useSectionConfig(id);
  if (section && section.visible === false) return null;
  if (applyOrder) {
    return (
      <div className="min-w-0" style={{ order: section?.order }}>
        {children}
      </div>
    );
  }
  return <>{children}</>;
}
