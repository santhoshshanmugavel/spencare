package com.spencare.capture.auth

import android.content.Context
import com.spencare.capture.BuildConfig
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.SessionStatus
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.builtin.Email as EmailProvider
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.SupabaseClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

/**
 * Manages the Supabase session for the Android capture app.
 *
 * The access token (JWT) from the session is used as a Bearer token
 * in every request to POST /api/capture/event.
 *
 * IMPORTANT: Supabase credentials are stored in BuildConfig (set via
 * local.properties / CI secrets, never hard-coded). The Supabase SDK
 * manages session persistence and automatic token refresh internally.
 *
 * Phase 3 will replace the PoC email/password sign-in with a deep-link
 * hand-off from the web app or a mobile OAuth flow.
 */
class AuthManager(
    private val context: Context,
    clientOverride: SupabaseClient? = null,
    private val sessionTimeoutMs: Long = 5_000L,
) {

    private val supabaseClient: SupabaseClient by lazy {
        clientOverride ?: createSupabaseClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
        ) {
            install(Auth)
        }
    }

    /** Returns the current access token or null if not signed in. */
    suspend fun getAccessToken(): String? = withContext(Dispatchers.IO) {
        try {
            val session = supabaseClient.auth.currentSessionOrNull()
            session?.accessToken
        } catch (e: Exception) {
            null
        }
    }

    /** Refreshes the session if expired and returns the fresh token. */
    suspend fun getRefreshedToken(): String? = withContext(Dispatchers.IO) {
        try {
            // supabase-kt loads session from storage asynchronously after client init.
            // Wait until that load completes before trying to refresh — avoids the race
            // where refreshCurrentSession() sees no in-memory session and returns null.
            withTimeout(sessionTimeoutMs) {
                supabaseClient.auth.sessionStatus
                    .filter { it !is SessionStatus.LoadingFromStorage }
                    .first()
            }
            supabaseClient.auth.refreshCurrentSession()
            supabaseClient.auth.currentSessionOrNull()?.accessToken
        } catch (e: TimeoutCancellationException) {
            null  // SDK init timed out; treat as no session rather than returning a stale token
        } catch (e: CancellationException) {
            throw e  // propagate real coroutine cancellation
        } catch (e: Exception) {
            supabaseClient.auth.currentSessionOrNull()?.accessToken
        }
    }

    /**
     * Signs in with email and password. Used only during PoC development
     * when there is no web-based sign-in flow for the Android app yet.
     *
     * Phase 3 will replace this with deep-link-based session hand-off from
     * the web app or a proper mobile OAuth flow.
     */
    suspend fun signInWithEmail(email: String, password: String): Boolean =
        withContext(Dispatchers.IO) {
            try {
                supabaseClient.auth.signInWith(EmailProvider) {
                    this.email = email
                    this.password = password
                }
                true
            } catch (e: Exception) {
                false
            }
        }

    /**
     * Returns true if the SDK has an in-memory session.
     *
     * @deprecated Unreliable after process restart — storage load is async.
     *   Use [getRefreshedToken] instead.
     */
    @Deprecated(
        message = "Unreliable after process restart. Use getRefreshedToken() instead.",
        replaceWith = ReplaceWith("getRefreshedToken() != null"),
    )
    fun isSignedIn(): Boolean {
        return try {
            supabaseClient.auth.currentSessionOrNull() != null
        } catch (e: Exception) {
            false
        }
    }
}
