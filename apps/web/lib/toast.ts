import { toast as sonnerToast } from "sonner";

/**
 * Toast/Undo foundation (design-system-specification.md §8). Three
 * variants, matching the evidenced two-tier severity system
 * (interaction-patterns.md §9) plus the Confirmed-action toast used by Web
 * manual-entry per confirmation-ui-specification.md §8 -- its styling
 * mirrors ConsequentialActionPreview's `confirmed` state (green, checkmark,
 * past tense, optional Undo action) so the *result* experience is
 * consistent across Web and Spensa even where the *proposal* step differs.
 */

/** Soft/recoverable warning (amber) -- e.g. an unsupported file type. */
export function toastWarning(message: string) {
  sonnerToast.warning(message);
}

/** Hard error (red) -- e.g. a file too large, or a failed mutation. */
export function toastError(message: string) {
  sonnerToast.error(message);
}

export interface ConfirmedToastOptions {
  /** Only render an Undo action when the underlying command's `undoable` flag is true (api-architecture.md §11). */
  undoable?: boolean;
  onUndo?: () => void;
}

/** Confirmed-action receipt (green, checkmark, past tense) with an optional Undo action. */
export function toastConfirmed(message: string, options: ConfirmedToastOptions = {}) {
  sonnerToast.success(message, {
    action:
      options.undoable && options.onUndo
        ? {
            label: "Undo",
            onClick: options.onUndo,
          }
        : undefined,
  });
}
