import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/service";
import {
  resolveTelegramLinkToken,
  saveChannelConnection,
  getAllTelegramConnections,
  disconnectChannel,
} from "@spencare/domain-infra";
import { sendTelegramMessage } from "@/lib/notifications/telegramProvider";

export async function POST(request: NextRequest) {
  const secretToken = request.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (expectedSecret && secretToken !== expectedSecret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: TelegramUpdate;
  try {
    body = await request.json() as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = body.message;
  if (!message?.chat?.id) {
    return NextResponse.json({ ok: true });
  }

  const chatId = String(message.chat.id);
  const text = (message.text ?? "").trim();
  const firstName = message.from?.first_name ?? "there";
  const username = message.from?.username;

  await handleMessage({ chatId, text, firstName, username });

  return NextResponse.json({ ok: true });
}

// ── Command router ────────────────────────────────────────────────────────────

async function handleMessage({
  chatId,
  text,
  firstName,
  username,
}: {
  chatId: string;
  text: string;
  firstName: string;
  username?: string;
}) {
  if (text.startsWith("/start")) {
    await handleStart({ chatId, text, firstName, username });
  } else if (text === "/help" || text.startsWith("/help ")) {
    await handleHelp(chatId);
  } else if (text === "/settings" || text.startsWith("/settings ")) {
    await handleSettings(chatId);
  } else if (text === "/disconnect" || text.startsWith("/disconnect ")) {
    await handleDisconnect(chatId);
  } else {
    await handleUnknown(chatId);
  }
}

// ── /start ────────────────────────────────────────────────────────────────────

async function handleStart({
  chatId,
  text,
  firstName,
  username,
}: {
  chatId: string;
  text: string;
  firstName: string;
  username?: string;
}) {
  const encryptionKey = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!encryptionKey) return; // Misconfigured — fail silently, ops alert separately

  // /start without a token (plain bot open or BotFather preview)
  if (text === "/start") {
    await reply(
      chatId,
      `👋 Hi ${firstName}! To connect your Spencare account, go to Settings → Notifications in the app and tap <b>Connect Telegram</b>.`,
    );
    return;
  }

  const token = text.slice("/start ".length).trim();
  if (!token) {
    await reply(chatId, "That link looks incomplete. Please generate a fresh connection link from Spencare.");
    return;
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const userId = await resolveTelegramLinkToken(serviceRoleSupabase, token);

  if (!userId) {
    await reply(
      chatId,
      "That link has expired or has already been used. Please tap <b>Connect Telegram</b> in Spencare to get a fresh one.",
    );
    return;
  }

  // All operations after this point are wrapped so that a failure returns 200
  // to Telegram (preventing retries that would hit the now-consumed token).
  try {
    // Cross-user chat_id guard
    const allConnections = await getAllTelegramConnections(serviceRoleSupabase, encryptionKey);

    const existingOwner = allConnections.find((c) => c.chatId === chatId && c.userId !== userId);
    if (existingOwner) {
      await reply(
        chatId,
        "This Telegram account is already connected to a different Spencare account. Please disconnect from that account first.",
      );
      return;
    }

    // Same user already connected — idempotent reconnect
    const alreadyConnected = allConnections.find((c) => c.chatId === chatId && c.userId === userId);
    if (alreadyConnected) {
      await reply(chatId, "You're already connected to Spencare. You're all set.");
      return;
    }

    await saveChannelConnection(
      serviceRoleSupabase,
      userId,
      "telegram",
      { chat_id: chatId, first_name: firstName, username },
      username ? `@${username}` : firstName,
      encryptionKey,
    );

    await reply(
      chatId,
      `\u{1F44B} Welcome to Spencare, ${firstName}!\n\nYour Telegram account is now connected. Spensa will send you important updates about your spending, budgets, goals, bills, and accounts here.\n\nManage your notification preferences anytime in <a href="https://spencare.vercel.app/settings/notifications">Spencare Settings</a>.`,
    );
  } catch {
    // Token was already consumed — send a safe error so the user knows to retry
    // from the app. Returning normally (not throwing) ensures Telegram gets 200
    // and does not retry this update, which would only see the consumed token.
    await reply(
      chatId,
      "We couldn't complete the connection right now. Please go back to Spencare and tap <b>Connect Telegram</b> again.",
    );
  }
}

// ── /help ─────────────────────────────────────────────────────────────────────

async function handleHelp(chatId: string) {
  await reply(
    chatId,
    `Spensa can keep you updated about:\n\n• Important transactions\n• Budget limits\n• Account balance warnings\n• Upcoming and overdue bills\n• Goal milestones\n• Weekly and monthly summaries\n\nManage your preferences in <a href="https://spencare.vercel.app/settings/notifications">Spencare Settings</a>.`,
  );
}

// ── /settings ─────────────────────────────────────────────────────────────────

async function handleSettings(chatId: string) {
  await reply(
    chatId,
    `Manage your Spencare notification preferences here:\n\nhttps://spencare.vercel.app/settings/notifications`,
  );
}

// ── /disconnect ───────────────────────────────────────────────────────────────

async function handleDisconnect(chatId: string) {
  const encryptionKey = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!encryptionKey) {
    await reply(chatId, "Unable to process your request right now. Please try again later.");
    return;
  }

  const serviceRoleSupabase = createServiceRoleSupabaseClient();
  const allConnections = await getAllTelegramConnections(serviceRoleSupabase, encryptionKey);

  // Find the Spencare user who owns this chat_id — completely server-side
  const connection = allConnections.find((c) => c.chatId === chatId);

  if (!connection) {
    await reply(
      chatId,
      "This Telegram account isn't connected to any Spencare account. Nothing to disconnect.",
    );
    return;
  }

  // Disconnect only the connection belonging to this chat_id's user
  await disconnectChannel(serviceRoleSupabase, connection.userId, "telegram");

  await reply(
    chatId,
    "Your Telegram connection has been removed from Spencare.\n\nYou won't receive Spencare notifications here anymore. You can reconnect anytime from Spencare → Settings → Notifications.",
  );
}

// ── Unknown command / plain message ──────────────────────────────────────────

async function handleUnknown(chatId: string) {
  await reply(
    chatId,
    "I'm here to send you important Spencare updates.\n\nTry /help to see what I can do, or manage your notification preferences in Spencare.",
  );
}

// ── Shared send helper ────────────────────────────────────────────────────────

async function reply(chatId: string, text: string): Promise<void> {
  await sendTelegramMessage(chatId, text).catch(() => undefined);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { first_name?: string; username?: string };
  };
}
