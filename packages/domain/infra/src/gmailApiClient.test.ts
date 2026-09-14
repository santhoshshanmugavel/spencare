import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildGmailAuthUrl,
  exchangeGmailAuthCode,
  refreshGmailAccessToken,
  fetchGoogleAccountEmail,
  listGmailMessageIds,
  getGmailProfileHistoryId,
  listGmailHistorySince,
  getGmailMessage,
  getGmailAttachmentData,
  GmailApiError,
  GMAIL_READONLY_SCOPE,
} from "./gmailApiClient.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildGmailAuthUrl", () => {
  it("builds a consent URL requesting offline access, forced re-consent, and only the readonly scope", () => {
    const url = buildGmailAuthUrl({ clientId: "client-id", clientSecret: "secret", redirectUri: "https://app.example/callback" }, "state-token");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(parsed.searchParams.get("client_id")).toBe("client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://app.example/callback");
    expect(parsed.searchParams.get("access_type")).toBe("offline");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("scope")).toContain(GMAIL_READONLY_SCOPE);
    expect(parsed.searchParams.get("scope")).not.toContain("gmail.modify");
    expect(parsed.searchParams.get("state")).toBe("state-token");
  });
});

describe("exchangeGmailAuthCode", () => {
  it("posts the authorization code and returns the token set, including the one-time refresh token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }));

    const result = await exchangeGmailAuthCode({ clientId: "c", clientSecret: "s", redirectUri: "r" }, "auth-code");

    expect(result).toEqual({ accessToken: "at-1", refreshToken: "rt-1", expiresInSeconds: 3600 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("grant_type=authorization_code");
    expect(String(init.body)).toContain("auth-code");
  });

  it("returns refreshToken: null when Google doesn't issue one (never fabricates one)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-1", expires_in: 3600 }));

    const result = await exchangeGmailAuthCode({ clientId: "c", clientSecret: "s", redirectUri: "r" }, "auth-code");
    expect(result.refreshToken).toBeNull();
  });
});

describe("refreshGmailAccessToken", () => {
  it("posts the refresh token and returns a fresh access token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "at-2", expires_in: 3600 }));

    const result = await refreshGmailAccessToken({ clientId: "c", clientSecret: "s" }, "rt-1");
    expect(result).toEqual({ accessToken: "at-2", expiresInSeconds: 3600 });
  });
});

describe("error handling / retries — Gmail API endpoints", () => {
  it("throws a GmailApiError marked isAuthError for a 401 (access token invalid)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(fetchGoogleAccountEmail("bad-token")).rejects.toMatchObject({ status: 401, isAuthError: true });
  });

  it("throws a GmailApiError NOT marked isAuthError for a 400 from the Gmail API", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));

    await expect(fetchGoogleAccountEmail("token")).rejects.toMatchObject({ status: 400, isAuthError: false });
  });

  it("throws a GmailApiError NOT marked isAuthError for a 403 from the Gmail API — 403 means 'forbidden' (API not enabled, scope insufficient, org policy), NOT 'token revoked'; reconnecting won't fix it", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));

    await expect(listGmailMessageIds("token", "query", null)).rejects.toMatchObject({ status: 403, isAuthError: false });
  });

  it("never includes the raw response body (or the token) in the thrown error message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("secret leak: at-123", { status: 403 }));

    let caught: unknown;
    try {
      await fetchGoogleAccountEmail("at-123");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GmailApiError);
    expect((caught as Error).message).not.toContain("at-123");
    expect((caught as Error).message).not.toContain("secret leak");
  });

  it("retries a 429 and succeeds on the next attempt", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "0" } })).mockResolvedValueOnce(jsonResponse({ email: "user@gmail.com" }));

    const email = await fetchGoogleAccountEmail("token");
    expect(email).toBe("user@gmail.com");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("refreshGmailAccessToken — token endpoint error handling", () => {
  it("marks isAuthError=true for 400 with error='invalid_grant' (refresh token genuinely revoked or expired)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400));

    await expect(refreshGmailAccessToken({ clientId: "c", clientSecret: "s" }, "stale-rt")).rejects.toMatchObject({ status: 400, isAuthError: true });
  });

  it("marks isAuthError=false for a 400 with a non-revocation error code (e.g. wrong client credentials at the token endpoint)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid_client" }, 400));

    await expect(refreshGmailAccessToken({ clientId: "c", clientSecret: "s" }, "rt-1")).rejects.toMatchObject({ status: 400, isAuthError: false });
  });

  it("marks isAuthError=false for a 400 when the response body is not parseable JSON (safe fallback)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("bad gateway", { status: 400, headers: { "content-type": "text/plain" } }));

    await expect(refreshGmailAccessToken({ clientId: "c", clientSecret: "s" }, "rt-1")).rejects.toMatchObject({ status: 400, isAuthError: false });
  });

  it("marks isAuthError=true for a 401 from the token endpoint (OAuth client not authenticated)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(refreshGmailAccessToken({ clientId: "c", clientSecret: "s" }, "rt-1")).rejects.toMatchObject({ status: 401, isAuthError: true });
  });
});

describe("listGmailMessageIds", () => {
  it("passes the search query and paginates via nextPageToken", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "page-2" }));

    const result = await listGmailMessageIds("token", "in:inbox bank", null);
    expect(result).toEqual({ messageIds: ["m1", "m2"], nextPageToken: "page-2" });
    const [url] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.get("q")).toBe("in:inbox bank");
  });

  it("returns an empty list, not an error, when Gmail reports no matching messages", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    expect(await listGmailMessageIds("token", "in:inbox nothingmatches", null)).toEqual({ messageIds: [], nextPageToken: null });
  });
});

describe("getGmailProfileHistoryId", () => {
  it("returns the mailbox's current historyId", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ historyId: "12345" }));
    expect(await getGmailProfileHistoryId("token")).toBe("12345");
  });
});

describe("listGmailHistorySince", () => {
  it("returns only added message ids and the new cursor", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        history: [{ messagesAdded: [{ message: { id: "m1" } }] }, { messagesAdded: [{ message: { id: "m2" } }] }],
        historyId: "999",
      }),
    );

    const result = await listGmailHistorySince("token", "12345", null);
    expect(result).toEqual({ messageIds: ["m1", "m2"], nextPageToken: null, newHistoryId: "999", historyExpired: false });
  });

  it("reports historyExpired: true on a 404, instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    const result = await listGmailHistorySince("token", "stale-cursor", null);
    expect(result.historyExpired).toBe(true);
    expect(result.messageIds).toEqual([]);
  });

  it("still throws for a genuine auth failure (401), never silently treating it as expired history", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(listGmailHistorySince("token", "cursor", null)).rejects.toMatchObject({ isAuthError: true });
  });
});

describe("getGmailMessage — MIME parsing", () => {
  function base64url(text: string): string {
    return Buffer.from(text, "utf8").toString("base64url");
  }

  it("extracts sender, subject, plain-text body, and filters attachments to PDFs only", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "m1",
        threadId: "t1",
        internalDate: "1735689600000",
        payload: {
          headers: [
            { name: "From", value: "HDFC Bank <alerts@hdfcbank.net>" },
            { name: "Subject", value: "Debit Alert" },
          ],
          parts: [
            { mimeType: "text/plain", body: { data: base64url("Your account was debited INR 500.") } },
            { mimeType: "application/pdf", filename: "statement.pdf", body: { attachmentId: "att-1", size: 2048 } },
            { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "att-2", size: 100 } },
          ],
        },
      }),
    );

    const message = await getGmailMessage("token", "m1");
    expect(message.senderEmail).toBe("alerts@hdfcbank.net");
    expect(message.subject).toBe("Debit Alert");
    expect(message.bodyText).toBe("Your account was debited INR 500.");
    expect(message.attachments).toEqual([{ attachmentId: "att-1", filename: "statement.pdf", mimeType: "application/pdf", sizeBytes: 2048 }]);
  });

  it("falls back to a stripped plain-text version of an HTML-only body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "m2",
        threadId: "t2",
        payload: {
          headers: [{ name: "From", value: "sender@example.com" }],
          parts: [{ mimeType: "text/html", body: { data: base64url("<p>Hello <b>World</b></p>") } }],
        },
      }),
    );

    const message = await getGmailMessage("token", "m2");
    expect(message.bodyText).toBe("Hello World");
  });

  it("recurses into nested multipart/alternative structures", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "m3",
        threadId: "t3",
        payload: {
          headers: [],
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [{ mimeType: "text/plain", body: { data: base64url("Nested plain text") } }],
            },
          ],
        },
      }),
    );

    const message = await getGmailMessage("token", "m3");
    expect(message.bodyText).toBe("Nested plain text");
  });
});

describe("getGmailAttachmentData", () => {
  it("base64url-decodes the attachment data into raw bytes", async () => {
    const raw = new Uint8Array([1, 2, 3, 4]);
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: Buffer.from(raw).toString("base64url") }));

    const result = await getGmailAttachmentData("token", "m1", "att-1");
    expect(Array.from(result)).toEqual([1, 2, 3, 4]);
  });
});
