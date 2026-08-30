import type { ReactNode } from "react";

/**
 * Plain centered content column for standalone legal/trust pages
 * (Phase 21 -- Terms of Service / Privacy Policy placeholders). Same
 * `min-h-dvh` + centered-column pattern as `(auth)/layout.tsx`
 * (design-tokens.md §3 `space.page`), just wider (`max-w-2xl` vs
 * `max-w-md`) since these hold prose, not a form -- no new layout
 * primitive introduced, only a wider instance of the one already in use.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-start justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center">
          <span className="bg-gradient-to-r from-primary to-[oklch(0.62_0.2_330)] bg-clip-text text-2xl font-bold text-transparent">
            Spencare
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
