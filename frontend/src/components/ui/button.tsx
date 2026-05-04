import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Button
 * ────────────────
 * Canonical variants from the editorial design system:
 *  - primary    gold bg, near-black text (`text-primary-foreground` = #1a1206)
 *  - secondary  transparent + strong border, hover gold border
 *  - ghost      transparent, hover muted background
 *  - buy        chartreuse tint, uppercase tracked label
 *  - sell       coral tint, uppercase tracked label
 *  - link       gold text + gold-dim underline, no padding
 *
 * Sizes: xs · sm (26px) · default (md, 34px) · lg (42px) · icon variants preserved.
 *
 * Icon sizing is driven by the variant: the base style applies `size-4` to any
 * svg that doesn't already carry a `size-*` class. `xs` and `icon-xs` override
 * to `size-3` for tight chrome. Callers should import lucide icons without a
 * size class and let the button paint them.
 *
 * Legacy aliases (default/outline/destructive/xs/icon*) remain mapped so the
 * rest of the codebase keeps rendering.
 */
const buttonVariants = cva(
  [
    "group/button ui-stateful inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
    "font-sans font-medium",
    "relative overflow-hidden rounded-sm border border-transparent",
    "outline-none transition-all select-none",
    "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    "active:scale-[0.98]",
    "aria-busy:cursor-wait data-[state=loading]:cursor-wait data-[state=loading]:opacity-90",
    "data-[state=stale]:border-amber data-[state=stale]:bg-amber/10",
    "data-[state=error]:border-down-500 data-[state=error]:bg-down-500/10",
    "disabled:pointer-events-none disabled:opacity-55",
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
        buy: "bg-up-500/10 text-up-500 border-up-500/30 hover:bg-up-500/20 uppercase tracking-[0.1em] text-label",
        sell: "bg-down-500/10 text-down-500 border-down-500/30 hover:bg-down-500/20 uppercase tracking-[0.1em] text-label",
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
        sm: "h-8 px-3 text-label",
        default: "h-9 px-4 text-body-sm",
        lg: "h-11 px-6 text-body",
        // Legacy sizes — preserved for existing callers
        xs: "h-7 px-2.5 text-label [&_svg:not([class*='size-'])]:size-3",
        icon: "size-[34px] p-0",
        "icon-xs": "size-7 p-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 p-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-[42px] p-0 [&_svg:not([class*='size-'])]:size-5",
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
