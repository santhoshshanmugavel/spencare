import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";

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

interface AuthContextValue {
  session: AuthSession | null;
  isLoading: boolean;
  /** Returns { requiresMfa: true, challengeToken } or { requiresMfa: false } */
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ requiresMfa: true; challengeToken: string } | { requiresMfa: false }>;
  verifyMfa: (challengeToken: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
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
    ): Promise<{ requiresMfa: true; challengeToken: string } | { requiresMfa: false }> => {
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
      return { requiresMfa: false };
    },
    [scheduleRefresh],
  );

  const verifyMfa = useCallback(
    async (challengeToken: string, code: string): Promise<void> => {
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
    },
    [scheduleRefresh],
  );

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
    <AuthContext.Provider value={{ session, isLoading, signIn, verifyMfa, signOut }}>
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
