"use client";

import { Blocks } from "loading-dev";
import { cn } from "@/lib/utils";

/**
 * <Loader> -- the canonical Spencare loading indicator. Thin wrapper
 * over loading-dev's `Blocks` spinner that locks the color to
 * `currentColor` so a Tailwind text class on this component (or any
 * ancestor) drives the loader color, matching whatever surface it
 * renders on. The default `text-primary` picks up the Spencare brand
 * accent in both light and dark modes via the theme's CSS tokens;
 * callers can override with `text-muted-foreground` for secondary
 * contexts, `text-success` for confirmation states, etc.
 *
 * Use <Loader> directly inside a button or inline chip. Use
 * <LoaderBlock> for a full dedicated loading surface (search result,
 * page section, dialog body) that needs a centered, labelled
 * presentation.
 */
export interface LoaderProps {
  /** Pixel size of the loader. Defaults to 24, which pairs well with body text. */
  size?: number;
  /**
   * Optional Tailwind class (e.g. `text-muted-foreground`,
   * `text-success`) to tint the loader. Defaults to `text-primary`.
   */
  className?: string;
  /** Accessible name announced by screen readers. */
  "aria-label"?: string;
}

export function Loader({ size = 24, className, "aria-label": ariaLabel = "Loading" }: LoaderProps) {
  return (
    <span role="status" aria-label={ariaLabel} className={cn("inline-flex text-primary", className)}>
      <Blocks size={size} color="currentColor" />
    </span>
  );
}

/**
 * Centered loading surface with an optional message. Use for dedicated
 * loading states where the UI is waiting for data (empty search
 * before results, section fetch, dialog body before content). Avoid
 * for inline button-is-busy states -- a Loader icon inside a Button
 * is enough there.
 */
export function LoaderBlock({
  size = 40,
  message,
  className,
  tone = "muted",
}: {
  size?: number;
  message?: string;
  className?: string;
  /** `primary` keeps the full Spencare accent; `muted` dims to muted-foreground for secondary surfaces where a bright accent would be too loud. */
  tone?: "primary" | "muted";
}) {
  const toneClass = tone === "muted" ? "text-muted-foreground" : "text-primary";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-6",
        toneClass,
        className,
      )}
      role="status"
      aria-label={message ?? "Loading"}
    >
      <Blocks size={size} color="currentColor" />
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
