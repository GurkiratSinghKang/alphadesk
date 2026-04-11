import { cn } from "@/lib/utils";

type PlaceholderFormat = "currency" | "percent" | "text" | "integer";

const PLACEHOLDER_TEXT: Record<PlaceholderFormat, string> = {
  currency: "$--.--",
  percent: "--.-%",
  text: "---",
  integer: "--",
};

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "always",
});

function formatValue(value: number | string, format: PlaceholderFormat): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return currencyFmt.format(value);
    case "percent":
      return percentFmt.format(value / 100);
    case "integer":
      return String(Math.round(value));
    default:
      return String(value);
  }
}

interface PlaceholderProps {
  value: number | string | null | undefined;
  format: PlaceholderFormat;
  className?: string;
}

export function Placeholder({ value, format, className }: PlaceholderProps) {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) {
    return (
      <span className={cn("text-[#555] tabular-nums", className)}>
        {PLACEHOLDER_TEXT[format]}
      </span>
    );
  }

  return (
    <span className={cn("tabular-nums transition-opacity duration-200", className)}>
      {formatValue(value, format)}
    </span>
  );
}
