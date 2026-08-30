"use client";

import { useRef, useState, useTransition, type ChangeEvent, type MouseEvent } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toastConfirmed, toastError } from "@/lib/toast";
import { removeGoalImageAction, updateGoalImageAction } from "@/app/goals/actions";

/**
 * Goal image upload -- same file-input-plus-transition shape as
 * `settings/profile/avatar-uploader.tsx`, adapted to the goal card's own
 * placeholder markup (`aspect-[3/2] bg-primary/10` + centered bold name,
 * `goal-card.tsx`/`goal-detail-dialog.tsx`'s existing "no-image fallback")
 * rather than the Avatar component, since that placeholder is what a goal
 * without an image already renders -- this only makes it a real drop
 * target instead of a dead end, and swaps it for an actual photo once one
 * exists. One component, reused at both the compact grid-card size and
 * the larger goal-detail size via `className`.
 *
 * States (Phase 26 mandate): Empty (this markup, "Add image" button) →
 * Selected/Loading (spinner overlay, buttons disabled) → Success (image
 * fills the frame) or Error (toast, frame reverts to its previous state
 * since local state is never optimistically updated before the server
 * confirms) → Edit (Replace/Remove, shown once an image exists).
 */
export function GoalImageUploader({
  goalId,
  goalName,
  initialSignedUrl,
  className,
}: {
  goalId: string;
  goalName: string;
  initialSignedUrl: string | null;
  className?: string;
}) {
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("image", file);
    startTransition(async () => {
      const result = await updateGoalImageAction(goalId, formData);
      if (result.ok) {
        setSignedUrl(result.value.signedUrl);
        toastConfirmed("Goal image updated.");
      } else {
        toastError(result.error.message);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await removeGoalImageAction(goalId);
      if (result.ok) {
        setSignedUrl(null);
        toastConfirmed("Goal image removed.");
      } else {
        toastError(result.error.message);
      }
    });
  }

  function handleChooseFile(e: MouseEvent) {
    e.stopPropagation();
    inputRef.current?.click();
  }

  return (
    <div
      className={cn(
        "relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden bg-primary/10",
        className,
      )}
    >
      {signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, short-lived signed URL, not a static asset Next's image optimizer can cache
        <img src={signedUrl} alt={`Photo for ${goalName}`} className="size-full object-cover" />
      ) : (
        <span className="px-4 text-center text-lg font-bold text-primary">{goalName}</span>
      )}

      {isPending ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <Loader2 className="size-6 animate-spin text-foreground" aria-hidden="true" />
          <span className="sr-only">Uploading…</span>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleChooseFile}
            aria-label={signedUrl ? `Replace ${goalName}'s image` : `Add an image for ${goalName}`}
          >
            <ImagePlus className="size-3.5" aria-hidden="true" />
            {signedUrl ? "Replace" : "Add image"}
          </Button>
          {signedUrl ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRemove}
              aria-label={`Remove ${goalName}'s image`}
            >
              <X className="size-3.5" aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label={`Upload an image for ${goalName}`}
        onChange={handleFileChange}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
