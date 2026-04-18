import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Button
 * ────────────────
 * Six canonical variants from the editorial design system:
 *  - primary   gold bg, near-black text (#1a1206)
 *  - secondary transparent + strong border, hover gold border
 *  - ghost     transparent, hover muted background
 *  - buy       chartreuse tint, uppercase tracked label
 *  - sell      coral tint, uppercase tracked label
 *  - link      gold text + gold-dim underline, no padding
 *
 * Sizes: sm (26px) · default (34px) · lg (42px) · icon variants preserved for callers.
 *
 * Legacy aliases (default/outline/destructive/xs/icon*) remain mapped so the rest
 * of the codebase keeps rendering; F2/F3 will migrate them to the new names.
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
    "font-sans font-medium",
    "rounded-sm border border-transparent",
    "outline-none transition-all select-none",
    "focus-visible:ring-1 focus-visible:ring-brand focus-visible:border-brand",
    "active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-brand text-primary-foreground hover:bg-gold-300",
        secondary:
          "bg-transparent text-fg border-border-strong hover:bg-bg-elev-1 hover:border-brand",
        ghost:
          "bg-transparent text-fg-dim hover:text-fg hover:bg-bg-elev-1",
        buy: "bg-up-500/10 text-up-500 border-up-500/30 hover:bg-up-500/20 uppercase tracking-[0.1em] text-[11px]",
        sell: "bg-down-500/10 text-down-500 border-down-500/30 hover:bg-down-500/20 uppercase tracking-[0.1em] text-[11px]",
        link: "bg-transparent text-brand border-0 border-b border-brand-dim rounded-none px-0 h-auto hover:text-gold-300",

        // Legacy aliases — keep older callers working
        default:
          "bg-brand text-primary-foreground hover:bg-gold-300",
        outline:
          "bg-transparent text-fg border-border-strong hover:bg-bg-elev-1 hover:border-brand",
        destructive:
          "bg-down-500/10 text-down-500 border-down-500/30 hover:bg-down-500/20",
      },
      size: {
        sm: "h-[26px] px-[10px] text-[11px]",
        default: "h-[34px] px-4 text-[12.5px]",
        lg: "h-[42px] px-6 text-[13px]",
        // Legacy sizes — preserved for existing callers
        xs: "h-6 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        icon: "size-[34px] p-0",
        "icon-xs": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[30px] p-0",
        "icon-lg": "size-[42px] p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "primary",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
