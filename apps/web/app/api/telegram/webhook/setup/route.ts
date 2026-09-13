import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/telegram/webhook/setup
 *
 * Registers (or re-registers) the Telegram webhook.
 * Protected by CRON_SECRET. Call once after deployment.
 *
 * Never logs or returns the bot token.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: "Bot token not configured" }, { status: 503 });

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const webhookUrl = "https://spencare.vercel.app/api/telegram/webhook";

  const body: Record<string, string> = { url: webhookUrl };
  if (webhookSecret) body.secret_token = webhookSecret;

  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { ok: boolean; description?: string };

  if (!data.ok) {
    return NextResponse.json({ error: data.description ?? "Telegram API error" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, url: webhookUrl });
}

/**
 * GET /api/telegram/webhook/setup
 *
 * Returns the current webhook info (masked). Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: "Bot token not configured" }, { status: 503 });

  const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
  const data = (await res.json()) as {
    ok: boolean;
    result?: { url: string; has_custom_certificate: boolean; pending_update_count: number; last_error_message?: string };
  };

  if (!data.ok || !data.result) {
    return NextResponse.json({ error: "Could not fetch webhook info" }, { status: 502 });
  }

  return NextResponse.json({
    url: data.result.url,
    pendingUpdates: data.result.pending_update_count,
    lastError: data.result.last_error_message ?? null,
    hasSecret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
  });
}
