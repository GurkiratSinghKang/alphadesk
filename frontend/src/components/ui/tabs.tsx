"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Tabs
 * ──────────────
 * Matches the in-kit tab pill. Inactive = muted tracked caps; active = full
 * contrast on bg-elev-1. Radix wiring untouched — this is a restyle only.
 */
function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center gap-1 p-1 rounded-sm group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "bg-bg-elev-1 border border-border-hair",
        line: "bg-transparent p-0 border-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "ui-stateful relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
        "min-h-8 px-3 rounded-sm",
        "font-sans text-[12px] font-semibold tracking-[0.12em] uppercase",
        "text-fg-muted hover:text-fg",
        "transition-colors",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-55",
        "data-active:bg-bg-elev-1 data-active:text-ink-1000 data-active:shadow-[inset_0_-2px_0_var(--brand)]",
        "data-[state=loading]:cursor-wait data-[state=stale]:border data-[state=stale]:border-amber data-[state=error]:border data-[state=error]:border-down-500",
        "group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "group-data-[variant=line]/tabs-list:data-active:border-b-2",
        "group-data-[variant=line]/tabs-list:data-active:border-brand",
        "group-data-[variant=line]/tabs-list:rounded-none",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
