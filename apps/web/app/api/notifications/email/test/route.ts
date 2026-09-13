import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sendNotificationEmail } from "@/lib/notifications/emailProvider";

export async function POST() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = user.email;
  if (!email) return NextResponse.json({ error: "No email address on account" }, { status: 422 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email delivery is not configured yet" }, { status: 503 });
  }

  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL ?? "hello@spencare.app";
  console.log("[email/test] sending to:", email, "from:", fromEmail);

  const result = await sendNotificationEmail({
    to: email,
    title: "Spencare email notifications are working",
    body: "This is a test from Spencare. You'll receive important financial updates here when something needs your attention.",
    actionUrl: "https://spencare.vercel.app/settings/notifications",
  });

  if (!result.ok) {
    console.error("[email/test] delivery failed:", result.error);
    const status = result.error?.includes("API key") ? 503
      : result.error?.includes("domain") || result.error?.includes("sender") || result.error?.includes("authorized") ? 422
      : 502;
    return NextResponse.json({ error: result.error ?? "Delivery failed" }, { status });
  }

  console.log("[email/test] accepted by provider, messageId:", result.messageId);
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
