export interface TelegramDeliveryResult {
  ok: boolean;
  messageId?: number;
  error?: string;
}

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  return token;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramDeliveryResult> {
  const token = getToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    const data = (await res.json()) as { ok: boolean; result?: { message_id: number }; description?: string };

    if (!data.ok) {
      return { ok: false, error: data.description ?? "Telegram API error" };
    }
    return { ok: true, messageId: data.result?.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

/**
 * Register the bot webhook with Telegram.
 * Called during setup — not needed at runtime.
 */
export async function setTelegramWebhook(webhookUrl: string): Promise<boolean> {
  const token = getToken();
  const url = `https://api.telegram.org/bot${token}/setWebhook`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const data = (await res.json()) as { ok: boolean };
  return data.ok;
}

/**
 * Register bot commands visible in the Telegram UI command picker.
 * Idempotent — safe to call on every cold start.
 */
export async function setTelegramBotCommands(): Promise<void> {
  const token = getToken();
  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commands: [
        { command: "start", description: "Connect your Spencare account" },
        { command: "help", description: "See what Spensa can help with" },
        { command: "settings", description: "Manage notification preferences" },
        { command: "disconnect", description: "Disconnect Telegram from Spencare" },
      ],
    }),
  }).catch(() => undefined); // Non-fatal
}
