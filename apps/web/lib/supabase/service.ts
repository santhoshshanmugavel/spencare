import { createServiceRoleClient, type TypedSupabaseClient } from "@spencare/domain-infra";

/**
 * Service-role client -- bypasses RLS and column-level grants. Used ONLY
 * by the security_settings sensitive-column operations
 * (packages/domain/application's 2FA commands). `SUPABASE_SERVICE_ROLE_KEY`
 * has no `NEXT_PUBLIC_` prefix, so Next.js never bundles it into
 * client-side JavaScript -- it only exists in the server process.
 */
export function createServiceRoleSupabaseClient(): TypedSupabaseClient {
  return createServiceRoleClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
