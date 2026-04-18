import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Input
 * ───────────────
 * 36px tall, bg-bg-elev-1 fill, hairline border, 4px radius.
 * Value text in mono tabular-nums so numeric entry stays aligned.
 * Focus: brand border + soft 3px gold ring.
 * Error: aria-invalid flips border to down-500; paired <InputHint> renders coral.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 px-3",
        "rounded-sm border border-border bg-bg-elev-1",
        "font-mono tabular-nums text-base md:text-[13px] text-ink-1000",
        // a11y audit r3: placeholder lifted from text-fg-hint to text-fg-muted
        // so placeholder copy passes AA once fg-muted token is lifted to ink-700.
        "placeholder:text-fg-muted placeholder:font-sans",
        "outline-none transition-colors",
        "focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_rgba(201,166,107,0.12)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-down-500",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg",
        className
      )}
      {...props}
    />
  )
}

export { Input }
