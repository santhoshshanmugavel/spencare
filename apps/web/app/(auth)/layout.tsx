import type { ReactNode } from "react";

/**
 * Centered auth column (~500-560px, design-system-specification.md §1 /
 * design-tokens.md layout.contentMaxWidth) -- `min-h-dvh`, not
 * `min-h-screen`, per Phase 5 §11 (mobile Safari's dynamic viewport
 * height). Generous, mostly-empty canvas per the evidenced auth-screen
 * spacing pattern (design-tokens.md §3 `space.page`).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 py-12 sm:px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <img src="/spencare-logo.svg" alt="Spencare" width={144} height={37} className="shrink-0" />
        </div>
        {children}
      </div>
    </div>
  );
}
