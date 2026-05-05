import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Textarea
 * ──────────────────
 * Matches Input styling — warm-ink fill, hairline border, gold focus ring,
 * mono body so numeric memos stay aligned. Grows with its own content
 * (`field-sizing-content`).
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full px-3 py-2",
        "rounded-sm border border-border bg-bg-elev-1",
        "font-sans text-body-sm text-fg",
        "placeholder:text-fg-hint",
        "outline-none transition-colors",
        "focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_rgba(201,166,107,0.12)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-down-500",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
