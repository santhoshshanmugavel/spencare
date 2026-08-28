import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 renamed the `middleware` file convention to `proxy`
 * (this repo's own node_modules/next/dist/docs/.../proxy.md notes the old
 * name is deprecated) -- kept the implementation in lib/supabase/middleware.ts
 * unchanged and named after its purpose (session refresh), not the file
 * convention it happens to be invoked from.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
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
