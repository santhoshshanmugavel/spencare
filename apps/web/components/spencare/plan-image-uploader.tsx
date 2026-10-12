"use client";

import { useRef, useState, useTransition, type ChangeEvent, type MouseEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/spencare/loader";
import { cn } from "@/lib/utils";
import { toastConfirmed, toastError } from "@/lib/toast";
import { removePlanImageAction, updatePlanImageAction } from "@/app/plans/actions";

/**
 * Plan image upload — mirrors GoalImageUploader exactly, wired to plan
 * image actions. Used on each plan card in the /plans list view.
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

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("image", file);
    startTransition(async () => {
      const result = await updatePlanImageAction(planId, formData);
      if (result.ok) {
        setSignedUrl(result.value.signedUrl);
        toastConfirmed("Plan image updated.");
      } else {
        toastError(result.error.message);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleRemove(e: MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await removePlanImageAction(planId);
      if (result.ok) {
        setSignedUrl(null);
        toastConfirmed("Plan image removed.");
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
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not a static asset
        <img src={signedUrl} alt={`Photo for ${planName}`} className="size-full object-cover" />
      ) : (
        <span className="px-4 text-center text-lg font-bold text-primary">{planName}</span>
      )}

      {isPending ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-foreground">
          <Loader size={24} />
          <span className="sr-only">Uploading…</span>
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleChooseFile}
            aria-label={signedUrl ? `Replace ${planName}'s image` : `Add an image for ${planName}`}
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
              aria-label={`Remove ${planName}'s image`}
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
        aria-label={`Upload an image for ${planName}`}
        onChange={handleFileChange}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
