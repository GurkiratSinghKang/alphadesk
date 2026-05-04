"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * AlphaDesk Table
 * ───────────────
 * Editorial table: tracked-caps headers, JetBrains Mono numeric cells with
 * tabular-nums, hairline row borders, subtle row hover. Matches the
 * `components-table.html` preview exactly in type and rhythm; drilldown /
 * interaction logic is left to composite consumers (positions row drawer,
 * etc.).
 *
 * Numeric columns should receive `text-right` explicitly via className on
 * <TableHead> / <TableCell>; first-column defaults to left alignment so
 * labels stay readable.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom border-collapse",
          "font-mono text-body-sm tabular-nums text-fg",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // Phase-2 / TBL-1 (2026 design brief, Brex/Airtable pattern):
      // sticky-by-default so column headers stay visible while the
      // body scrolls. ``sticky top-0`` is a no-op when the parent
      // container isn't vertically scrollable, so this is safe to
      // make the global default. Background uses the warm card token
      // so the header isn't translucent over scrolled rows; z-10
      // wins over standard row hover but stays below dialog/popover.
      className={cn(
        "sticky top-0 z-10 bg-[color:var(--bg-card)]",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child>td]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border bg-bg-elev-1/50 font-medium",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "ui-stateful transition-colors hover:bg-bg-elev-1 focus-within:bg-bg-elev-1",
        "data-[state=selected]:bg-bg-elev-1",
        "data-[state=loading]:cursor-wait data-[state=stale]:bg-amber/5 data-[state=error]:bg-down-500/5",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, scope, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      // a11y audit r3 — WCAG 1.3.1: default scope to "col" so VoiceOver's
      // table rotor associates cells with their column header. Consumers can
      // override by passing a custom scope (e.g. "row" for row-header usage).
      scope={scope ?? "col"}
      className={cn(
        "px-3 py-2 align-middle whitespace-nowrap",
        "font-sans text-label font-semibold tracking-[0.12em] uppercase text-fg-muted",
        "text-right first:text-left",
        "border-b border-border",
        "[&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap",
        "text-right first:text-left",
        "border-b border-border-hair",
        "[&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-body-sm text-fg-muted", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
