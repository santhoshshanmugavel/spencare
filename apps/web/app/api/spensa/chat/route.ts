import { NextResponse, type NextRequest } from "next/server";
import { sendMessage } from "@spencare/ai";
import type { AuthContext } from "@spencare/domain-application";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";

/**
 * `/api/spensa/chat` -- Phase 16's streaming transport (locked decision
 * §20: "choose the simplest production-safe server-to-browser transport
 * that fits the existing Next.js architecture" -- no source document
 * specifies SSE/WebSocket/RSC, so this is an implementation decision,
 * documented here and in the final report).
 *
 * CHOSEN: Server-Sent Events over a plain Route Handler returning a
 * `ReadableStream`. WHY: one-way server->client streaming is all this
 * needs (the client never needs to push mid-stream); a `fetch()` response
 * body reader on the client consumes it with zero new dependencies (no
 * socket.io, no separate WS server, nothing beyond what Next.js's Route
 * Handlers already support); it composes trivially with this app's
 * existing cookie-based Supabase session (a plain authenticated GET/POST,
 * unlike a WebSocket upgrade which would need its own auth handshake).
 *
 * CANCELLATION: closing the client's `EventSource`/aborting the fetch
 * (e.g. navigating away) triggers the Route Handler's `request.signal`
 * abort, which the underlying `sendMessage` async generator observes via
 * normal for-await early-return semantics -- no explicit cancellation
 * token needed beyond what Web Streams already provide.
 *
 * PARTIAL-MESSAGE BEHAVIOR: text is streamed as it's generated
 * (`text_delta` events); if the connection drops mid-stream, whatever was
 * already yielded is lost client-side, but the server-side message
 * persistence in `sendMessage` only ever inserts a message row for a
 * COMPLETE assistant turn -- there is no partial/torn message row.
 *
 * TOOL-CALL VISIBILITY: `tool_call_started`/`tool_call_result` events are
 * streamed distinctly from `text_delta`, so the UI can show "Checking
 * your Safe-to-Spend..." rather than a silent pause -- streaming does not
 * weaken the confirmation boundary: a `proposal` event is still just data
 * describing a `pending_confirmations` row; nothing about streaming lets
 * a write execute without the separate, later `confirmCommand` call.
 */

async function requireAuthContext(): Promise<AuthContext> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return {
    userId: user.id,
    email: user.email ?? "",
    supabase,
    serviceRoleSupabase: createServiceRoleSupabaseClient(),
  };
}

export async function POST(request: NextRequest) {
  let ctx: AuthContext;
  try {
    ctx = await requireAuthContext();
  } catch {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();

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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
