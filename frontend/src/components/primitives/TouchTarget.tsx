import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * TouchTarget
 * ───────────
 * The shared 44×44 tap-floor primitive. WCAG 2.5.5 (Target Size, Level
 * AAA) recommends a minimum touch-target of 44×44 CSS px; Apple HIG and
 * Material Design both call out the same floor (44pt / 48dp). Before this
 * primitive, 26 sites hand-applied `min-h-[44px]` (and often paired it
 * with `min-w-[44px]`) which fragmented the tap-floor across the codebase.
 *
 * The primitive renders a tiny inline-flex wrapper that:
 *  - guarantees `min-h-touch` (44px from `--spacing-touch`)
 *  - guarantees `min-w-touch` for icon-only / square hit areas
 *  - centers its child via inline-flex (so the visual stays whatever size
 *    you wanted; only the *hit area* is bumped to 44px)
 *  - honors the global `:where(*):focus-visible` outline (set in
 *    globals.css `@layer base`) without any extra ring boilerplate
 *
 * For controls already laid out as buttons/anchors, the simpler migration
 * is to just swap `min-h-[44px]` → `min-h-touch` (Tailwind utility wired
 * to the same token). Reach for `<TouchTarget>` when the surrounding
 * layout is the wrong size and you need a wrapper that expands the click
 * area without disturbing the visual rendering.
 *
 * Pattern (wrap-only, e.g. an icon button visually 24×24):
 * ```tsx
 * <TouchTarget asChild>
 *   <button onClick={...} aria-label="Close">
 *     <X className="size-4" />
 *   </button>
 * </TouchTarget>
 * ```
 *
 * `asChild` clones the only child element and merges classes/refs so the
 * element you pass in IS the tap-floor — no extra DOM wrapper. If you do
 * not pass `asChild`, a `<div>` wrapper is rendered with the floor classes.
 */
export interface TouchTargetProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * If true, clone the only child element and merge the touch-floor
   * classes onto it instead of rendering a wrapper div. Useful when the
   * parent layout cares about the DOM shape (e.g. a flex row that should
   * count the button itself, not a wrapper).
   */
  asChild?: boolean;
  className?: string;
}

const TOUCH_FLOOR_CLASS =
  "min-h-touch min-w-touch inline-flex items-center justify-center";

export const TouchTarget = React.forwardRef<HTMLDivElement, TouchTargetProps>(
  function TouchTarget({ asChild, className, children, ...rest }, ref) {
    if (asChild) {
      // Validate single child to avoid silent prop-drop. React.Children.only
      // throws a clear error in dev.
      const child = React.Children.only(children) as React.ReactElement<{
        className?: string;
      }>;
      const childClass = child.props?.className ?? "";
      // Note: we deliberately do NOT merge refs onto the cloned child. The
      // touch-floor primitive's job is to project class names + the
      // `data-slot` marker; ref ownership stays with the consumer's child
      // element so we don't tangle two refs into one. If both this primitive
      // and the consumer need a ref, the consumer should attach their own
      // ref to the child directly — `forwardRef`'s `ref` here only attaches
      // when `asChild` is false (the wrapper-div branch below).
      return React.cloneElement(
        child,
        {
          className: cn(TOUCH_FLOOR_CLASS, childClass, className),
          // Tag for visual debugging / styling hooks. Cast through
          // Record<string, unknown> so the data-* attribute is accepted
          // regardless of the child element's prop type.
          "data-slot": "touch-target",
          ...rest,
        } as Record<string, unknown>,
      );
    }

    return (
      <div
        ref={ref}
        data-slot="touch-target"
        className={cn(TOUCH_FLOOR_CLASS, className)}
        {...rest}
      >
        {children}
      </div>
    );
  },
);

TouchTarget.displayName = "TouchTarget";

export default TouchTarget;
