import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { getChannelConnectionMetadata } from "@spencare/domain-infra";
import { sendTelegramMessage } from "@/lib/notifications/telegramProvider";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const encryptionKey = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!encryptionKey) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const serviceRoleSupabase = createServiceRoleSupabaseClient();

  const meta = await getChannelConnectionMetadata<{ chat_id: string }>(
    serviceRoleSupabase,
    user.id,
    "telegram",
    encryptionKey,
  );

  if (!meta?.chat_id) {
    return NextResponse.json({ error: "Telegram not connected" }, { status: 404 });
  }

  const result = await sendTelegramMessage(
    meta.chat_id,
    "✓ Spencare Telegram connection is working.\n\nYou'll receive important notifications here when something needs your attention.",
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Delivery failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
