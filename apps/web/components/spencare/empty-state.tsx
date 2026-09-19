import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateAction {
  label: string;
  /** Render as a real <a> link when href is provided — required for accessible "link" role in tests and screen readers. */
  href?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  className?: string;
  size?: "sm" | "md" | "lg";
}

function ActionButton({ action, size }: { action: EmptyStateAction; size: "sm" | "md" | "lg" }) {
  const btnSize = size === "lg" ? "default" : "sm";
  if (action.href) {
    return (
      <Button asChild size={btnSize}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button size={btnSize} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

function SecondaryActionButton({ action, size }: { action: EmptyStateAction; size: "sm" | "md" | "lg" }) {
  const btnSize = size === "lg" ? "default" : "sm";
  if (action.href) {
    return (
      <Button asChild variant="ghost" size={btnSize}>
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button variant="ghost" size={btnSize} onClick={action.onClick}>
      {action.label}
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = "md",
}: EmptyStateProps) {
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
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-[var(--radius-lg)] bg-muted text-muted-foreground",
            size === "sm" && "size-10",
            size === "md" && "size-12",
            size === "lg" && "size-16"
          )}
        >
          {icon}
        </div>
      )}

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
        {description && (
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
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {action && <ActionButton action={action} size={size} />}
          {secondaryAction && <SecondaryActionButton action={secondaryAction} size={size} />}
        </div>
      )}
    </div>
  );
}
