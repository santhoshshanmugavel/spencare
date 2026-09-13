import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import { generateTelegramLinkToken } from "@spencare/domain-application";

/**
 * POST /api/notifications/telegram/connect
 *
 * Returns a one-time token the user will send to @Spencare_bot.
 * The token is single-use, 10-minute TTL.
 * Token value is never stored anywhere except Supabase (hashed via the lookup).
 */
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = { userId: user.id, email: user.email ?? "", supabase, serviceRoleSupabase: createServiceRoleSupabaseClient() };
  const token = await generateTelegramLinkToken(ctx);

  // The deep link opens Telegram with /start <token> prefilled
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "Spencare_bot";
  const deepLink = `https://t.me/${botUsername}?start=${token}`;

  return NextResponse.json({ url: deepLink });
}
