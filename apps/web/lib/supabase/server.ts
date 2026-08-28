import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@spencare/domain-infra";

/**
 * Server-side Supabase client for Server Actions/Route Handlers/Server
 * Components -- reads/writes the session via Next.js's cookie store, so
 * every operation runs with the CALLER'S OWN RLS-scoped session (never a
 * client-supplied user id). This is the client `AuthContext.supabase`
 * (packages/domain/application) is built from.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component -- middleware refreshes the
            // session cookie instead. Safe to ignore here.
          }
        },
      },
    },
  );
}
