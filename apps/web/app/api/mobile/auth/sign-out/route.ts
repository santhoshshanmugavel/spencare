import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!accessToken) {
    return Response.json({ error: "Missing authorization header." }, { status: 401 });
  }

  // Use anon client seeded with the access token so signOut scopes to this session.
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Validate the token first; bail if it's already invalid / expired.
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    // The client considers itself signed out; surface success so it clears local storage.
    return Response.json({ success: true });
  }

  // Set the session so signOut targets the correct token.
  await anonClient.auth.setSession({ access_token: accessToken, refresh_token: "" });
  await anonClient.auth.signOut({ scope: "local" });

  return Response.json({ success: true });
}
