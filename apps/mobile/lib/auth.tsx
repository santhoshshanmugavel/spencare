import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import { api } from "./api";

// Redirect URI registered in app.json `scheme` and in Supabase's allowed redirect URLs.
const GOOGLE_REDIRECT_URI = "spencare://auth/callback";

// Generates a PKCE verifier + challenge pair using expo-crypto.
// Uses SHA-256 per RFC 7636 §4.2.
async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  // Convert Uint8Array → binary string for btoa (available in Hermes/RN 0.73+).
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join("");
  const verifier = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  // digestStringAsync returns standard base64; convert to base64url.
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const challenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return { verifier, challenge };
}

// ── Session storage keys ───────────────────────────────────────────────────────

const KEYS = {
  ACCESS_TOKEN: "spencare.access_token",
  REFRESH_TOKEN: "spencare.refresh_token",
  EXPIRES_AT: "spencare.expires_at",
  USER_ID: "spencare.user_id",
  USER_EMAIL: "spencare.user_email",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: AuthUser;
}

type GoogleSignInResult =
  | { cancelled: true }
  | { cancelled: false; requiresMfa: true; challengeToken: string }
  | { cancelled: false; requiresMfa: false; accessToken: string };

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  /** Returns { requiresMfa: true, challengeToken } or { requiresMfa: false, accessToken } */
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ requiresMfa: true; challengeToken: string } | { requiresMfa: false; accessToken: string }>;
  signUp: (email: string, password: string) => Promise<void>;
  verifyMfa: (challengeToken: string, code: string) => Promise<{ accessToken: string }>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<GoogleSignInResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Secure storage helpers ────────────────────────────────────────────────────

async function persistSession(s: AuthSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, s.accessToken),
    SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, s.refreshToken),
    SecureStore.setItemAsync(KEYS.EXPIRES_AT, String(s.expiresAt)),
    SecureStore.setItemAsync(KEYS.USER_ID, s.user.id),
    SecureStore.setItemAsync(KEYS.USER_EMAIL, s.user.email ?? ""),
  ]);
}

async function clearSession(): Promise<void> {
  await Promise.all(Object.values(KEYS).map((k) => SecureStore.deleteItemAsync(k)));
}

async function restoreSession(): Promise<AuthSession | null> {
  const [at, rt, exp, uid, email] = await Promise.all([
    SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
    SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
    SecureStore.getItemAsync(KEYS.EXPIRES_AT),
    SecureStore.getItemAsync(KEYS.USER_ID),
    SecureStore.getItemAsync(KEYS.USER_EMAIL),
  ]);
  if (!at || !rt || !exp || !uid) return null;
  return {
    accessToken: at,
    refreshToken: rt,
    expiresAt: Number(exp),
    user: { id: uid, email: email || undefined },
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Passing `user` explicitly prevents a stale-closure bug: when the timer fires
  // (up to ~1 hour later), session state from the useCallback closure would be
  // stale. The user identity does not change during a session, so passing it as
  // an argument is safe.
  const scheduleRefresh = useCallback((expiresAt: number, refreshToken: string, user: AuthUser) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const msUntilExpiry = expiresAt * 1000 - Date.now();
    // Refresh 2 minutes before expiry, or immediately if already close.
    const delay = Math.max(0, msUntilExpiry - 2 * 60 * 1000);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const refreshed = await api.refresh(refreshToken);
        const next: AuthSession = {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: refreshed.expires_at,
          user,
        };
        await persistSession(next);
        setSession(next);
        scheduleRefresh(next.expiresAt, next.refreshToken, user);
      } catch {
        // Refresh failed — session is expired; require re-login.
        await clearSession();
        setSession(null);
      }
    }, delay);
  }, []); // no session dependency — user is passed explicitly, never captured from closure

  // Restore persisted session on mount.
  useEffect(() => {
    (async () => {
      try {
        const restored = await restoreSession();
        if (restored) {
          // If already expired, try to refresh immediately.
          if (restored.expiresAt * 1000 < Date.now()) {
            const refreshed = await api.refresh(restored.refreshToken);
            const next: AuthSession = {
              accessToken: refreshed.access_token,
              refreshToken: refreshed.refresh_token,
              expiresAt: refreshed.expires_at,
              user: restored.user,
            };
            await persistSession(next);
            setSession(next);
            scheduleRefresh(next.expiresAt, next.refreshToken, restored.user);
          } else {
            setSession(restored);
            scheduleRefresh(restored.expiresAt, restored.refreshToken, restored.user);
          }
        }
      } catch {
        await clearSession();
      } finally {
        setIsLoading(false);
      }
    })();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ requiresMfa: true; challengeToken: string } | { requiresMfa: false; accessToken: string }> => {
      const result = await api.signIn(email, password);
      if (result.requires_2fa) {
        // Challenge token is not an authenticated session — do NOT persist it.
        return { requiresMfa: true, challengeToken: result.challenge_token };
      }
      const s: AuthSession = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_at,
        user: { id: result.user.id, email: result.user.email },
      };
      await persistSession(s);
      setSession(s);
      scheduleRefresh(s.expiresAt, s.refreshToken, s.user);
      return { requiresMfa: false, accessToken: s.accessToken };
    },
    [scheduleRefresh],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<void> => {
      const result = await api.signUp(email, password);
      const s: AuthSession = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_at,
        user: { id: result.user.id, email: result.user.email },
      };
      await persistSession(s);
      setSession(s);
      scheduleRefresh(s.expiresAt, s.refreshToken, s.user);
    },
    [scheduleRefresh],
  );

  const verifyMfa = useCallback(
    async (challengeToken: string, code: string): Promise<{ accessToken: string }> => {
      // The real Supabase session is only released here, after MFA succeeds.
      // A challenge token is never stored as an authenticated session.
      const result = await api.verifyMfa(challengeToken, code);
      const s: AuthSession = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: result.expires_at,
        user: { id: result.user.id },
      };
      await persistSession(s);
      setSession(s);
      scheduleRefresh(s.expiresAt, s.refreshToken, s.user);
      return { accessToken: s.accessToken };
    },
    [scheduleRefresh],
  );

  const signInWithGoogle = useCallback(async (): Promise<GoogleSignInResult> => {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      throw new Error(
        "[Spencare] EXPO_PUBLIC_SUPABASE_URL is not set.\n" +
          "Add it to apps/mobile/.env.local:\n" +
          "  EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co",
      );
    }

    const { verifier, challenge } = await generatePKCE();

    const params = new URLSearchParams({
      provider: "google",
      redirect_to: GOOGLE_REDIRECT_URI,
      code_challenge: challenge,
      code_challenge_method: "s256",
    });
    const authUrl = `${supabaseUrl}/auth/v1/authorize?${params.toString()}`;

    const result = await WebBrowser.openAuthSessionAsync(authUrl, GOOGLE_REDIRECT_URI);
    if (result.type !== "success") {
      return { cancelled: true };
    }

    // Parse the authorization code from the callback URL.
    // Strip any hash fragment first so that a crafted URL like
    // spencare://auth/callback#?code=X cannot inject a code via the fragment.
    const callbackUrl = result.url;
    const hashPos = callbackUrl.indexOf("#");
    const urlBeforeHash = hashPos >= 0 ? callbackUrl.slice(0, hashPos) : callbackUrl;
    const queryStart = urlBeforeHash.indexOf("?");
    const queryString = queryStart >= 0 ? urlBeforeHash.slice(queryStart + 1) : "";
    const callbackParams = new URLSearchParams(queryString);

    const error = callbackParams.get("error");
    if (error) {
      const desc = callbackParams.get("error_description") ?? error;
      throw new Error(desc);
    }

    const code = callbackParams.get("code");
    if (!code) {
      return { cancelled: true };
    }

    // Exchange the code server-side (MFA check happens in the route).
    const authResult = await api.googleAuth({
      code,
      code_verifier: verifier,
      redirect_uri: GOOGLE_REDIRECT_URI,
    });

    if (authResult.requires_2fa) {
      return {
        cancelled: false,
        requiresMfa: true,
        challengeToken: authResult.challenge_token,
      };
    }

    const s: AuthSession = {
      accessToken: authResult.access_token,
      refreshToken: authResult.refresh_token,
      expiresAt: authResult.expires_at,
      user: { id: authResult.user.id, email: authResult.user.email },
    };
    await persistSession(s);
    setSession(s);
    scheduleRefresh(s.expiresAt, s.refreshToken, s.user);
    return { cancelled: false, requiresMfa: false, accessToken: s.accessToken };
  }, [scheduleRefresh]);

  const signOut = useCallback(async (): Promise<void> => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (session?.accessToken) {
      try {
        await api.signOut(session.accessToken);
      } catch {
        // Best-effort server revocation — clear local state regardless.
      }
    }
    await clearSession();
    setSession(null);
  }, [session]);

  return (
    <AuthContext.Provider value={{ session, isLoading, signIn, signUp, verifyMfa, signOut, signInWithGoogle }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ── Onboarding check ─────────────────────────────────────────────────────────
// Shared by sign-in and verify-mfa to decide post-auth routing.
// Returns 'incomplete' for 404/profile-not-found (new user needs onboarding).
// Returns 'error' for network/server failures (don't block authenticated user).

export async function checkOnboarding(
  accessToken: string,
): Promise<"complete" | "incomplete" | "error"> {
  try {
    const status = await api.getOnboardingStatus(accessToken);
    return status.completed ? "complete" : "incomplete";
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      return "incomplete";
    }
    return "error";
  }
}
