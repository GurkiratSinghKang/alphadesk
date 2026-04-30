import type { OrderStatus } from "@/types";

export const WORKING_ORDER_STATUSES = new Set<string>([
  "pending",
  "pending_new",
  "submitted",
  "accepted",
  "accepted_for_bidding",
  "new",
  "open",
  "partial",
  "partial_fill",
  "partially_filled",
]);

export function isWorkingOrderStatus(
  status: OrderStatus | string | null | undefined,
): boolean {
  return typeof status === "string" && WORKING_ORDER_STATUSES.has(status);
}
