"use client";

import {
  ArrowRight,
  Brain,
  ChartLineUp,
  Checks,
  ShieldCheck,
} from "@phosphor-icons/react";

type IconKind = "arrow" | "brain" | "chart" | "checks" | "shield";

interface AuthFrameIconProps {
  kind: IconKind;
  className?: string;
}

const icons = {
  arrow: ArrowRight,
  brain: Brain,
  chart: ChartLineUp,
  checks: Checks,
  shield: ShieldCheck,
};

export default function AuthFrameIcon({ kind, className }: AuthFrameIconProps) {
  const Icon = icons[kind];
  return <Icon className={className} aria-hidden weight="regular" />;
}
