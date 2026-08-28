import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Replaces the create-next-app scaffold (flagged as stale/dead content in
 * the Phase 4B/4C Foundation audits) now that Auth exists to route
 * against. Not itself a page -- routes to /home if signed in, /login
 * otherwise. Middleware's own redirect handles the unauthenticated case
 * for every other protected route; this is the one root path middleware
 * doesn't specially rewrite, so it needs an explicit decision here.
 */
export default async function RootPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/home" : "/login");
}
