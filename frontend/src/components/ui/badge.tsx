import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Badge
 * ───────────────
 * Status badges from the editorial kit. Each variant renders a colored 6px LED
 * dot next to a tracked-caps label. Five canonical tones:
 *  - active (chartreuse, solid dot with subtle glow)
 *  - paused (amber, solid dot)
 *  - halted (coral, pulsing dot)
 *  - idle   (muted, ghost border, dim dot)
 *  - ai     (gold, gold dot)
 *
 * Legacy aliases (default/secondary/destructive/outline/ghost/link) still map
 * to the closest semantic tone so prior callers keep rendering. Callers
 * supplying a dot pass <Badge><span class="badge-dot"/>Label</Badge>; when no
 * child with `data-slot="badge-dot"` is present, callers can use the new
 * `withDot` prop to inject the LED automatically.
 */
const badgeVariants = cva(
  [
    "group/badge inline-flex items-center gap-1.5",
    "h-[22px] px-2.5 py-0",
    "rounded-sm border text-[10px] font-semibold tracking-[0.16em] uppercase",
    "font-sans whitespace-nowrap",
    "transition-colors",
    "focus-visible:ring-1 focus-visible:ring-brand",
  ].join(" "),
  {
    variants: {
      variant: {
        active:
          "text-up-500 bg-up-500/10 border-up-500/25",
        paused:
          "text-amber bg-amber/10 border-amber/25",
        halted:
          "text-down-500 bg-down-500/10 border-down-500/25",
        idle:
          "text-fg-muted bg-transparent border-border",
        ai: "text-gold-300 bg-brand/10 border-brand/30",

        // Legacy aliases
        default:
          "text-up-500 bg-up-500/10 border-up-500/25",
        secondary:
          "text-fg bg-bg-elev-2 border-border",
        destructive:
          "text-down-500 bg-down-500/10 border-down-500/25",
        outline:
          "text-fg-muted bg-transparent border-border",
        ghost:
          "text-fg-muted bg-transparent border-transparent",
        link:
          "text-brand border-transparent underline underline-offset-2",
      },
    },
    defaultVariants: {
      variant: "idle",
    },
  }
)

const dotToneClass: Record<string, string> = {
  active: "bg-up-500 shadow-[0_0_6px_var(--up-500)]",
  paused: "bg-amber",
  halted: "bg-down-500 animate-pulse",
  idle: "bg-fg-muted",
  ai: "bg-gold-300",
  default: "bg-up-500 shadow-[0_0_6px_var(--up-500)]",
  secondary: "bg-fg-muted",
  destructive: "bg-down-500 animate-pulse",
  outline: "bg-fg-muted",
  ghost: "bg-fg-muted",
  link: "bg-brand",
}

type BadgeProps = useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** When true, the component prepends a colored LED dot matching the variant. */
    withDot?: boolean
  }

function Badge({
  className,
  variant = "idle",
  render,
  withDot,
  children,
  ...props
}: BadgeProps) {
  const toneKey = variant ?? "idle"
  const dotClass = dotToneClass[toneKey] ?? dotToneClass.idle

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
        children: (
          <>
            {withDot ? (
              <span
                data-slot="badge-dot"
                aria-hidden
                className={cn("inline-block h-1.5 w-1.5 rounded-full", dotClass)}
              />
            ) : null}
            {children}
          </>
        ),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
