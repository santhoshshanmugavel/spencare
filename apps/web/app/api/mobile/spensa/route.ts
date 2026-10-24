import { createClient } from "@supabase/supabase-js";
import { sendMessage } from "@spencare/ai";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { sendMessageSchema } from "@spencare/validation";

function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ")) return null;
  return auth.slice(7).trim() || null;
}

/**
 * Mobile Spensa AI chat endpoint.
 *
 * Uses Bearer token auth (not cookie session) so the mobile app can
 * authenticate with its stored access token rather than a browser session.
 *
 * Streams Server-Sent Events back to the React Native client using the
 * same event protocol as /api/spensa/chat, so the mobile UI can reuse
 * the same event-parsing logic.
 *
 * The underlying sendMessage function is identical to the web version —
 * same tools, same Privacy Mode enforcement, same proposal-only write
 * semantics, same AI provider selection.
 */
export async function POST(request: Request): Promise<Response> {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return Response.json({ error: "Missing authorization header." }, { status: 401 });
  }

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return Response.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const ctx = {
    userId: userData.user.id,
    email: userData.user.email ?? "",
    supabase: userClient,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = sendMessageSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Validation error." }, { status: 400 });
  }
  const body = parsed.data;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const event of sendMessage(ctx, body)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (request.signal.aborted) break;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      // Client disconnected — the for-await above will exit on next iteration.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
