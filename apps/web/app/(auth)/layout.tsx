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
