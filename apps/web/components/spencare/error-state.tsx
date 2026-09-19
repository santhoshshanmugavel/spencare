import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function ErrorState({
  title = "Something went wrong",
  description = "An error occurred while loading this content.",
  onRetry,
  className,
  size = "md",
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "sm" && "gap-2 py-8 px-4",
        size === "md" && "gap-3 py-12 px-6",
        size === "lg" && "gap-4 py-20 px-8",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-[var(--radius-lg)] bg-destructive/10 text-destructive",
          size === "sm" && "size-10",
          size === "md" && "size-12",
          size === "lg" && "size-16"
        )}
      >
        <AlertCircle
          className={cn(
            size === "sm" && "size-5",
            size === "md" && "size-6",
            size === "lg" && "size-8"
          )}
        />
      </div>

      <div className={cn("space-y-1", size === "lg" && "space-y-2")}>
        <p
          className={cn(
            "font-medium text-foreground",
            size === "sm" && "text-sm",
            size === "md" && "text-sm",
            size === "lg" && "text-base"
          )}
        >
          {title}
        </p>
        <p
          className={cn(
            "text-muted-foreground max-w-xs",
            size === "sm" && "text-xs",
            size === "md" && "text-xs",
            size === "lg" && "text-sm"
          )}
        >
          {description}
        </p>
      </div>

      {onRetry && (
        <Button
          variant="outline"
          size={size === "lg" ? "default" : "sm"}
          onClick={onRetry}
          className="mt-1 gap-2"
        >
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}
