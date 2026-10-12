"use client";

import { useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent } from "react";
import { Camera, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/spencare/loader";
import { cn } from "@/lib/utils";
import { toastConfirmed, toastError } from "@/lib/toast";
import { removePlanImageAction, updatePlanImageAction } from "@/app/plans/actions";

/**
 * Plan image upload. Replaces the small "Add image" corner button with a
 * full-area clickable placeholder so the feature is immediately discoverable
 * on both the /plans list and the /plans/[planId] detail page.
 *
 * Empty state   → centered camera icon + "Add cover image" — entire area is
 *                 clickable and keyboard-activatable; no hover required.
 * Image state   → image fills the frame; a permanently-visible pill at the
 *                 bottom-right provides "Change" and "Remove" — not hover-only.
 * Pending state → spinner overlay; underlying controls disabled.
 */
export function PlanImageUploader({
  planId,
  planName,
  initialSignedUrl,
  className,
}: {
  planId: string;
  planName: string;
  initialSignedUrl: string | null;
  className?: string;
}) {
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    inputRef.current?.click();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current?.click();
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("image", file);
    startTransition(async () => {
      const result = await updatePlanImageAction(planId, formData);
      if (result.ok) {
        setSignedUrl(result.value.signedUrl);
        toastConfirmed("Cover image updated.");
      } else {
        toastError(result.error.message);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleRemove(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await removePlanImageAction(planId);
      if (result.ok) {
        setSignedUrl(null);
        toastConfirmed("Cover image removed.");
      } else {
        toastError(result.error.message);
      }
    });
  }

  return (
    <div className={cn("relative aspect-[3/2] w-full overflow-hidden", className)}>
      {signedUrl ? (
        /* ── Image state ─────────────────────────────────────────────── */
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL */}
          <img src={signedUrl} alt={`Cover photo for ${planName}`} className="size-full object-cover" />

          {/* Always-visible pill — no hover required */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1.5 bg-gradient-to-t from-black/50 to-transparent p-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={openPicker}
              aria-label={`Change cover image for ${planName}`}
              disabled={isPending}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Change
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleRemove}
              aria-label={`Remove cover image for ${planName}`}
              disabled={isPending}
            >
              <X className="size-3.5" aria-hidden="true" />
              Remove
            </Button>
          </div>
        </>
      ) : (
        /* ── Empty state — entire area is clickable ──────────────────── */
        <div
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          aria-label={`Add cover image for ${planName}`}
          className={cn(
            "flex size-full cursor-pointer flex-col items-center justify-center gap-2 bg-primary/10",
            "text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isPending && "pointer-events-none",
          )}
        >
          {isPending ? (
            <Loader size={24} />
          ) : (
            <>
              <Camera className="size-6 opacity-70" aria-hidden="true" />
              <span className="text-sm font-medium">Add cover image</span>
            </>
          )}
        </div>
      )}

      {/* Spinner overlay for image-state pending */}
      {isPending && signedUrl ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
          <Loader size={24} />
          <span className="sr-only">Uploading…</span>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label={`Upload a cover image for ${planName}`}
        onChange={handleFileChange}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      />
    </div>
  );
}
