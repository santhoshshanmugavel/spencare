import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@spencare/domain-infra";

/**
 * The ONLY factory that constructs a browser-side Supabase client. Per the
 * Phase 5 reconnaissance note: this file (and its `server.ts`/
 * `service.ts` siblings) is the sole place under `apps/web` allowed to
 * import `@supabase/ssr`/`@supabase/supabase-js` -- every Server
 * Action/Route Handler/component imports one of these factories instead,
 * which keeps the existing dependency-cruiser "no direct database access
 * from UI" rule meaningfully enforced without needing to change the rule
 * itself.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
