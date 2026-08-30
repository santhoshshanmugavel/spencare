import { headers } from "next/headers";

/**
 * The current request's origin, derived the same way for every OAuth
 * redirect this app builds (Google Sign-In's `signInWithGoogleAction`,
 * Gmail's dedicated `beginGmailConnectAction` -- Phase 19). Extracted here
 * once both needed it, rather than duplicated per Server Action file.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host");
  return `${proto}://${host}`;
}
