import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not configured.");
    // Validate key is pure ASCII — non-ASCII chars (e.g. emoji from clipboard)
    // cause a ByteString crash in Node.js fetch headers.
    if (/[^\x20-\x7E]/.test(key)) {
      throw new Error("RESEND_API_KEY contains invalid characters. Re-copy the key from the Resend dashboard (plain text only).");
    }
    _resend = new Resend(key);
  }
  return _resend;
}

export interface EmailDeliveryResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendNotificationEmail(opts: {
  to: string;
  title: string;
  body: string;
  actionUrl?: string;
}): Promise<EmailDeliveryResult> {
  const fromName = process.env.NOTIFICATION_FROM_NAME ?? "Spencare";
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL ?? "hello@spencare.app";

  const html = buildEmailHtml(opts.title, opts.body, opts.actionUrl);

  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: opts.to,
      subject: opts.title,
      html,
    });

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, messageId: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

function buildEmailHtml(title: string, body: string, actionUrl?: string): string {
  const actionBlock = actionUrl
    ? `<p style="margin-top:24px">
         <a href="${actionUrl}" style="display:inline-block;padding:10px 20px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px;font-size:14px">
           View in Spencare
         </a>
       </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
          <tr>
            <td style="padding:32px 32px 8px">
              <p style="margin:0 0 4px;font-size:12px;color:#999;letter-spacing:.05em;text-transform:uppercase">Spencare</p>
              <h1 style="margin:0;font-size:20px;font-weight:600;color:#111;line-height:1.3">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px">
              <p style="margin:0;font-size:15px;color:#444;line-height:1.6">${escapeHtml(body)}</p>
              ${actionBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #f0f0f0">
              <p style="margin:0;font-size:12px;color:#bbb">
                You're receiving this because you have email notifications enabled in Spencare.
                Sign in to adjust your notification settings.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
