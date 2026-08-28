"use client";

import { useRef, useState, useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toastConfirmed, toastError } from "@/lib/toast";
import { removeAvatarAction, updateAvatarAction } from "../actions";

export function AvatarUploader({
  initialSignedUrl,
  fallbackInitial,
}: {
  initialSignedUrl: string | null;
  fallbackInitial: string;
}) {
  const [signedUrl, setSignedUrl] = useState(initialSignedUrl);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("avatar", file);
    startTransition(async () => {
      const result = await updateAvatarAction(formData);
      if (result.ok) {
        setSignedUrl(result.value.signedUrl);
        toastConfirmed("Photo updated.");
      } else {
        toastError(result.error.message);
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function handleRemove() {
    startTransition(async () => {
      const result = await removeAvatarAction();
      if (result.ok) {
        setSignedUrl(null);
        toastConfirmed("Photo removed.");
      } else {
        toastError(result.error.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        <AvatarImage src={signedUrl ?? undefined} alt="" />
        <AvatarFallback className="text-lg">{fallbackInitial}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          size="touch"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? "Uploading…" : "Change photo"}
        </Button>
        {signedUrl ? (
          <Button type="button" variant="ghost" size="touch" disabled={isPending} onClick={handleRemove}>
            Remove
          </Button>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Upload a profile photo"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}
