import { createClient } from "@supabase/supabase-js";
import { mobileRefreshSchema } from "@spencare/validation";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = mobileRefreshSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { refresh_token } = parsed.data;

  // Use the anon client -- refreshSession goes through Auth, not service-role.
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token });

  if (error || !data.session) {
    return Response.json({ error: "Session expired. Sign in again." }, { status: 401 });
  }

  return Response.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
}
