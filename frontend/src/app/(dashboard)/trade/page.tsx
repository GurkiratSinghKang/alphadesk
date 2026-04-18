"use client";

/**
 * `/trade` — redirected to the flagship desk at `/`.
 *
 * Before F3 this page owned the trading workspace. The new flagship
 * desk (at `/`) composes `DeskLayout` with the Layer-2 composites, and
 * the legacy panel-based workspace is deferred to the panel retirement
 * pass (F4). This stub keeps existing bookmarks and internal links
 * working by redirecting on mount.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TradeRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
