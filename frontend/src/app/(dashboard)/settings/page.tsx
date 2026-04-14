"use client";

import { Settings, Bell, Shield, Key, Palette, Monitor } from "lucide-react";
import { useUIStore } from "@/stores/ui";

export default function SettingsPage() {
  const tradingMode = useUIStore((s) => s.tradingMode);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-[var(--panel)] p-4">
          <div className="flex items-center gap-3 mb-3">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Trading Mode</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            Currently in <span className="font-medium text-foreground">{tradingMode === "paper" ? "Paper Trading" : "Live Trading"}</span> mode.
            Trading mode is configured server-side. Contact admin to switch.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-[var(--panel)] p-4">
          <div className="flex items-center gap-3 mb-3">
            <Key className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">API Keys</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Alpaca API keys are configured on the server. Contact admin to update brokerage credentials.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-[var(--panel)] p-4">
          <div className="flex items-center gap-3 mb-3">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Notifications</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Price alerts and pipeline notifications are delivered via the notification center. Configure alerts on the Alerts page.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-[var(--panel)] p-4">
          <div className="flex items-center gap-3 mb-3">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Security</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Sessions expire after 8 hours. JWT tokens are stored in HttpOnly cookies with Secure and SameSite flags.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-[var(--panel)] p-4">
          <div className="flex items-center gap-3 mb-3">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Appearance</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            AlphaDesk uses a dark OLED-optimized theme. Theme customization coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
