import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { applySecurityHeaders } from "@/lib/security-headers";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`
 * (this repo's own node_modules/next/dist/docs/.../proxy.md notes the old
 * name is deprecated) -- kept the implementation in lib/supabase/middleware.ts
 * unchanged and named after its purpose (session refresh), not the file
 * convention it happens to be invoked from.
 *
 * Security headers (Phase 21) are layered on here, after session
 * handling, so `updateSession`'s own redirect/pass-through logic and its
 * existing tests stay untouched -- every response this proxy returns
 * (redirect or pass-through) gets the same header set.
 */
export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    /*
     * Match every request except static assets/images/favicon, so the
     * session cookie is refreshed on every navigation without doing
     * unnecessary work on asset requests.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
