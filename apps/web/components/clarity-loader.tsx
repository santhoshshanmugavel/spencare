"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

/**
 * Gates Microsoft Clarity initialization behind Privacy Mode. The root
 * layout (app/layout.tsx) is an unauthenticated server component --
 * it also renders /login and /signup -- so it has no per-user context to
 * decide this itself. This client component asks /api/privacy-mode once
 * on mount and only injects Clarity's script when the answer is
 * `enabled: false` (or there is no session at all, matching Clarity's
 * previous unconditional-on behavior for logged-out/public pages).
 *
 * Privacy Mode OFF or no session -> unchanged existing behavior (Clarity
 * loads exactly as before this fix).
 * Privacy Mode ON -> Clarity's script is never injected for this page
 * load, so no new tracking/session capture starts for the protected
 * finance UI. This does not retroactively stop or clear a session that
 * was already running before the user turned Privacy Mode on in the same
 * browser tab; it only prevents new initialization on future loads.
 *
 * Not a legal/compliance claim -- purely "don't start new Clarity
 * tracking while Privacy Mode is on."
 */
export function ClarityLoader({ projectId }: { projectId: string }) {
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/privacy-mode")
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: { enabled: boolean }) => {
        if (!cancelled && !data.enabled) setShouldLoad(true);
      })
      .catch(() => {
        // Network/auth failure: fail open to the pre-existing behavior
        // (Clarity loads) rather than silently guessing Privacy Mode's
        // state.
        if (!cancelled) setShouldLoad(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!shouldLoad) return null;

  return (
    <Script id="microsoft-clarity" strategy="afterInteractive">
      {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${projectId}");`}
    </Script>
  );
}
