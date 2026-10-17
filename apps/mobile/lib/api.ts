// Typed fetch wrapper for /api/mobile/* endpoints.
// All auth state (access token) is supplied by the caller via the options arg;
// this module has no global mutable state.

const API_BASE = process.env.EXPO_PUBLIC_API_URL;

if (!API_BASE) {
  // Fail loudly at module load so the developer sees this immediately.
  // In production, Metro will tree-shake the dead branch and this never fires
  // because EXPO_PUBLIC_API_URL is always set in the production build.
  throw new Error(
    "[Spencare] EXPO_PUBLIC_API_URL is not set.\n" +
      "Create apps/mobile/.env.local and add:\n" +
      "  EXPO_PUBLIC_API_URL=http://localhost:3000   (iOS Simulator)\n" +
      "  EXPO_PUBLIC_API_URL=http://10.0.2.2:3000   (Android Emulator)",
  );
}

export type ApiError = { error: string | Record<string, unknown> };

export interface SignInNoMfaResponse {
  requires_2fa: false;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string };
}

export interface SignInMfaResponse {
  requires_2fa: true;
  challenge_token: string;
  expires_at: string;
}

export type SignInResponse = SignInNoMfaResponse | SignInMfaResponse;

export interface VerifyMfaResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
  mfa_method: "totp" | "backup_code";
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function post<T>(
  path: string,
  body: unknown,
  accessToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE as string}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error((data as ApiError).error?.toString() ?? "Unknown error");
  return data as T;
}

export const api = {
  signIn: (email: string, password: string) =>
    post<SignInResponse>("/api/mobile/auth/sign-in", { email, password }),

  verifyMfa: (challengeToken: string, code: string) =>
    post<VerifyMfaResponse>("/api/mobile/auth/verify-2fa", {
      challenge_token: challengeToken,
      code,
    }),

  refresh: (refreshToken: string) =>
    post<RefreshResponse>("/api/mobile/auth/refresh", { refresh_token: refreshToken }),

  signOut: (accessToken: string) =>
    post<{ success: boolean }>("/api/mobile/auth/sign-out", {}, accessToken),
};
