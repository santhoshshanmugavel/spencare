package com.spencare.capture.auth

import android.content.Context
import com.spencare.capture.BuildConfig
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.builtin.Email as EmailProvider
import io.github.jan.supabase.createSupabaseClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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
class AuthManager(private val context: Context) {

    private val supabaseClient by lazy {
        createSupabaseClient(
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
            supabaseClient.auth.refreshCurrentSession()
            supabaseClient.auth.currentSessionOrNull()?.accessToken
        } catch (e: Exception) {
            getAccessToken()
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
     * Returns true if the Supabase SDK has a cached session.
     *
     * Uses gotrue.currentSessionOrNull() — the SDK's own in-memory session
     * cache — rather than a separate storage key. This accurately reflects
     * whether the user is signed in, including after a successful loginWith()
     * call in the same process lifetime.
     *
     * For a durable check across process restarts, call getAccessToken()
     * (suspend) which triggers a full session load from the SDK's storage.
     */
    fun isSignedIn(): Boolean {
        return try {
            supabaseClient.auth.currentSessionOrNull() != null
        } catch (e: Exception) {
            false
        }
    }
}
