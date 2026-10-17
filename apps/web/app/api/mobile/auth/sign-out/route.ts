import { createClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!accessToken) {
    return Response.json({ error: "Missing authorization header." }, { status: 401 });
  }

  // Validate the token before touching any admin API.
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    // Token already invalid — client should clear local state; return success.
    return Response.json({ success: true });
  }

  // admin.signOut(jwt, scope) properly invalidates the session on the Auth server.
  // scope:"local" revokes this specific session (identified by the access token)
  // without affecting the user's other devices.
  const serviceClient = createServiceRoleSupabaseClient();
  await serviceClient.auth.admin.signOut(accessToken, "local");

  return Response.json({ success: true });
}
