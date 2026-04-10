"use client";

import { TopBar } from "@/components/layout/TopBar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <main className="flex-1 min-h-0">{children}</main>
      <CommandPalette />
    </div>
  );
}
