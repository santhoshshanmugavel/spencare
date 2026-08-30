import type { ReactNode } from "react";

/**
 * Same centered, chrome-free treatment as `(auth)/layout.tsx` (login/
 * signup) -- a consent screen is exactly that kind of surface: focused,
 * no app navigation, the user's full attention on one decision.
 */
export default function OAuthAuthorizeLayout({ children }: { children: ReactNode }) {
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
