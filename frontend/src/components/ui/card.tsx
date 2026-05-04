import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Card
 * ──────────────
 * Warm-ink surface. Optional 2px left-edge accent (`leftAccent`) and a
 * `hoverable` flag that lifts 1px and darkens border on hover — matches the
 * strategy-card pattern in the design kit (`components-cards.html`).
 *
 * Backwards compatible: existing `<Card>` usages keep working — no accent, no
 * hover lift by default.
 */
type CardProps = React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  leftAccent?: "brand" | "loss" | "none"
  hoverable?: boolean
}

const accentClass: Record<"brand" | "loss" | "none", string> = {
  brand:
    "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-brand before:transition-all",
  loss:
    "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-down-500 before:transition-all",
  none: "",
}

function Card({
  className,
  size = "default",
  leftAccent = "none",
  hoverable = false,
  ...props
}: CardProps) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-accent={leftAccent}
      className={cn(
        "group/card relative flex flex-col gap-3 overflow-hidden",
        "rounded-md border border-border bg-bg-card text-card-foreground text-sm",
        "px-4 py-4",
        "has-data-[slot=card-header]:px-0 has-data-[slot=card-content]:px-0 has-data-[slot=card-footer]:px-0",
        "has-data-[slot=card-footer]:pb-0",
        accentClass[leftAccent],
        hoverable &&
          "cursor-pointer transition-all duration-150 hover:bg-bg-elev-1 hover:border-border-strong hover:-translate-y-px hover:before:w-[3px]",
        size === "sm" && "gap-2 py-3",
        "data-[size=sm]:gap-2 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0",
        "*:[img:first-child]:rounded-t-md *:[img:last-child]:rounded-b-md",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1 px-4",
        "group-data-[size=sm]/card:px-3",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        "has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "[.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-display italic text-h3 leading-snug text-ink-1000",
        "group-data-[size=sm]/card:text-body",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-body-sm text-fg-muted", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center border-t border-border-hair bg-bg-elev-1/50 p-4",
        "group-data-[size=sm]/card:p-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
