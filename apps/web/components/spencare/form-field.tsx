import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Shared label+input+error wiring for every Auth/Settings form
 * (accessibility-requirements.md §9: error text associated via
 * aria-describedby, aria-invalid set programmatically -- not indicated by
 * color alone). The child input is responsible for `id`, `aria-invalid`,
 * and `aria-describedby={error ? errorId(id) : undefined}` -- this
 * component only renders the label/error chrome consistently.
 */

export function errorId(fieldId: string): string {
  return `${fieldId}-error`;
}

export interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ id, label, error, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={errorId(id)} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
