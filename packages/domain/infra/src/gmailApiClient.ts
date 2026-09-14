/**
 * Gmail/Google OAuth REST adapter (Phase 19). Deliberately zero new npm
 * dependencies -- both Google's OAuth token endpoint and the Gmail REST
 * API are simple JSON-over-HTTPS, and the official `googleapis` client
 * library would pull in generated clients for every Google API this
 * product will never call, for what amounts to five `fetch` calls (Rule
 * 19: "never install unnecessary dependencies"). This file is the ONLY
 * place in the codebase that talks to Google's OAuth/Gmail endpoints --
 * `apps/web` never imports it directly (dependency-cruiser enforces this,
 * see `.dependency-cruiser.cjs`), only `domain-application` commands do.
 *
 * Every function here is a thin, typed wrapper over one HTTP call --
 * no business logic, no persistence, no encryption (that's
 * `gmailConnectionsRepo.ts`/`crypto.ts`). Access/refresh tokens that pass
 * through this module are never logged; callers are responsible for the
 * same discipline (see `gmailSync.ts` in domain-application).
 */

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** The single, least-privilege scope Phase 19 requests (locked decision #5) -- read-only, no send/modify/delete. */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GmailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** True for 401/403 (token invalid/revoked) -- callers use this to distinguish "reconnect required" from a transient/retryable failure. */
    public readonly isAuthError: boolean,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

async function requestJson(url: string, init: RequestInit, retriesLeft = 2): Promise<unknown> {
  const response = await fetch(url, init);
  if (response.status === 429 || response.status >= 500) {
    if (retriesLeft > 0) {
      const retryAfterHeader = response.headers.get("retry-after");
      const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 500 * (3 - retriesLeft);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5000)));
      return requestJson(url, init, retriesLeft - 1);
    }
  }
  if (!response.ok) {
    // 401 = access token invalid/expired → user must reconnect.
    // 403 from the Gmail API does NOT mean "token revoked" — it means the
    // request is forbidden for reasons like the Gmail API not being enabled
    // in Google Cloud Console, an org policy blocking API access, or
    // insufficient scope. Reconnecting won't fix those causes, so 403 is NOT
    // an auth error here. Only 401 warrants the "reconnect" advice.
    const isAuthError = response.status === 401;
    // Never include response body verbatim in the thrown message -- Google
    // error bodies can echo back query params (which never contain tokens
    // here, but this is the safe-by-default posture, matching this
    // codebase's "never surface raw provider errors" convention).
    throw new GmailApiError(`Gmail API request failed (${response.status})`, response.status, isAuthError);
  }
  return response.json();
}

/**
 * Token-endpoint variant of requestJson. Distinct from the Gmail API
 * variant because the Google token endpoint uses different HTTP status
 * semantics:
 *   - 400 + {"error":"invalid_grant"} = refresh token revoked or expired
 *     → isAuthError true (user must reconnect to get a fresh token)
 *   - 400 + any other error = bad request (wrong params) → isAuthError false
 *   - 401/403 = client credentials wrong or client suspended → isAuthError true
 * Reads only the `error` field of the 400 body; never logs or surfaces the
 * full body (matches the "never surface raw provider errors" convention).
 */
async function requestTokenJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    if (response.status === 400) {
      const body = await response.json().catch(() => null);
      const isRevoked = (body as { error?: string } | null)?.error === "invalid_grant";
      throw new GmailApiError(`Gmail token request failed (${response.status})`, response.status, isRevoked);
    }
    throw new GmailApiError(`Gmail token request failed (${response.status})`, response.status, true);
  }
  return response.json();
}

// ============================================================
// OAuth
// ============================================================

/** Builds the Google consent-screen URL for the dedicated Gmail authorization flow (locked decision #5: never bundled into Sign-In). `access_type=offline` + `prompt=consent` are required to reliably receive a `refresh_token` (Google only issues one on first consent or when consent is re-forced). */
export function buildGmailAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: `openid email ${GMAIL_READONLY_SCOPE}`,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GmailTokenSet {
  accessToken: string;
  /** Absent when Google doesn't issue a fresh one (e.g. a rare re-consent edge case) -- the caller must keep the previously stored refresh token in that case, never overwrite it with nothing. */
  refreshToken: string | null;
  expiresInSeconds: number;
}

/** Authorization-code exchange -- the ONE moment a refresh token is ever available in this flow (see this file's header comment); the caller must encrypt and persist it immediately. */
export async function exchangeGmailAuthCode(config: GoogleOAuthConfig, code: string): Promise<GmailTokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code,
    grant_type: "authorization_code",
  });
  const data = (await requestTokenJson(GOOGLE_TOKEN_ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } })) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresInSeconds: data.expires_in };
}

/** Exchanges a stored refresh token for a fresh, short-lived access token -- called once per sync run, never persisted (only the refresh token is durable). */
export async function refreshGmailAccessToken(config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">, refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const data = (await requestTokenJson(GOOGLE_TOKEN_ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } })) as {
    access_token: string;
    expires_in: number;
  };
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

/** The connected Google account's own email address -- shown in the Settings UI so the user knows which account is connected. Never any other profile field. */
export async function fetchGoogleAccountEmail(accessToken: string): Promise<string> {
  const data = (await requestJson(GOOGLE_USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } })) as { email: string };
  return data.email;
}

// ============================================================
// Gmail messages
// ============================================================

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

export interface GmailMessageListPage {
  messageIds: string[];
  nextPageToken: string | null;
}

/** Bounded, targeted search (Part 22: never a raw mailbox scan) -- `query` is a Gmail search-operator string built by the caller (gmailSync.ts owns the actual query text). */
export async function listGmailMessageIds(accessToken: string, query: string, pageToken: string | null, maxResults = 50): Promise<GmailMessageListPage> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (pageToken) params.set("pageToken", pageToken);
  const data = (await requestJson(`${GMAIL_API_BASE}/messages?${params.toString()}`, { headers: authHeaders(accessToken) })) as {
    messages?: { id: string }[];
    nextPageToken?: string;
  };
  return { messageIds: (data.messages ?? []).map((m) => m.id), nextPageToken: data.nextPageToken ?? null };
}

/** The current mailbox historyId -- the incremental-sync cursor to store after a successful initial sync. */
export async function getGmailProfileHistoryId(accessToken: string): Promise<string> {
  const data = (await requestJson(`${GMAIL_API_BASE}/profile`, { headers: authHeaders(accessToken) })) as { historyId: string };
  return data.historyId;
}

export interface GmailHistoryPage {
  messageIds: string[];
  nextPageToken: string | null;
  newHistoryId: string | null;
  /** True when Gmail reports the stored cursor is too old (its history retention window, typically ~7 days, has passed) -- the caller must fall back to a bounded full sync (Part 14: "handle Gmail history expiration"), never error out or silently miss messages. */
  historyExpired: boolean;
}

/** Incremental sync (Part 21/Decision 4): only messages ADDED since `startHistoryId`, never a mailbox rescan. */
export async function listGmailHistorySince(accessToken: string, startHistoryId: string, pageToken: string | null): Promise<GmailHistoryPage> {
  const params = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
  if (pageToken) params.set("pageToken", pageToken);
  try {
    const data = (await requestJson(`${GMAIL_API_BASE}/history?${params.toString()}`, { headers: authHeaders(accessToken) })) as {
      history?: { messagesAdded?: { message: { id: string } }[] }[];
      nextPageToken?: string;
      historyId?: string;
    };
    const messageIds = (data.history ?? []).flatMap((h) => (h.messagesAdded ?? []).map((m) => m.message.id));
    return { messageIds, nextPageToken: data.nextPageToken ?? null, newHistoryId: data.historyId ?? null, historyExpired: false };
  } catch (e) {
    if (e instanceof GmailApiError && e.status === 404) {
      return { messageIds: [], nextPageToken: null, newHistoryId: null, historyExpired: true };
    }
    throw e;
  }
}

export interface GmailAttachmentMeta {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  senderEmail: string | null;
  subject: string | null;
  receivedAtIso: string | null;
  /** Plain text only -- HTML-only bodies are stripped to text (see `htmlToPlainText` below); never the raw HTML markup, matching "email content is DATA, never markup/code to render or execute." */
  bodyText: string;
  attachments: GmailAttachmentMeta[];
}

interface GmailApiPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailApiPart[];
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Recursively walks a (possibly multipart) message payload for the best text body and any attachment parts. Prefers text/plain over text/html; falls back to a stripped HTML body only when no plain-text part exists. */
function walkParts(part: GmailApiPart, acc: { plainText: string | null; htmlText: string | null; attachments: GmailAttachmentMeta[] }): void {
  if (part.filename && part.body?.attachmentId) {
    acc.attachments.push({
      attachmentId: part.body.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      sizeBytes: part.body.size ?? 0,
    });
    return;
  }
  if (part.mimeType === "text/plain" && part.body?.data && !acc.plainText) {
    acc.plainText = base64UrlDecode(part.body.data);
  } else if (part.mimeType === "text/html" && part.body?.data && !acc.htmlText) {
    acc.htmlText = base64UrlDecode(part.body.data);
  }
  for (const child of part.parts ?? []) walkParts(child, acc);
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string | null {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/** Extracts just the email address from an RFC 5322 "Display Name <email@domain>" From header. */
function extractEmailAddress(fromHeader: string | null): string | null {
  if (!fromHeader) return null;
  const match = /<([^>]+)>/.exec(fromHeader);
  return match ? match[1]! : fromHeader.trim();
}

export async function getGmailMessage(accessToken: string, messageId: string): Promise<GmailMessageDetail> {
  const data = (await requestJson(`${GMAIL_API_BASE}/messages/${messageId}?format=full`, { headers: authHeaders(accessToken) })) as {
    id: string;
    threadId: string;
    internalDate?: string;
    payload: GmailApiPart;
  };
  const acc = { plainText: null as string | null, htmlText: null as string | null, attachments: [] as GmailAttachmentMeta[] };
  walkParts(data.payload, acc);
  const headers = data.payload.headers;
  return {
    id: data.id,
    threadId: data.threadId,
    senderEmail: extractEmailAddress(headerValue(headers, "From")),
    subject: headerValue(headers, "Subject"),
    receivedAtIso: data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null,
    bodyText: acc.plainText ?? (acc.htmlText ? htmlToPlainText(acc.htmlText) : ""),
    attachments: acc.attachments.filter((a) => a.mimeType === "application/pdf"),
  };
}

/** Downloads one attachment's raw bytes -- called only for attachments already identified as `application/pdf` by `getGmailMessage`, and only up to the caller's own size bound (checked BEFORE this call using the metadata's `sizeBytes`, per Part 32/45 -- never download an oversized attachment first and reject it after). */
export async function getGmailAttachmentData(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const data = (await requestJson(`${GMAIL_API_BASE}/messages/${messageId}/attachments/${attachmentId}`, { headers: authHeaders(accessToken) })) as { data: string };
  return new Uint8Array(Buffer.from(data.data, "base64url"));
}
