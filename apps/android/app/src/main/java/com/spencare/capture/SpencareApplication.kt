package com.spencare.capture

import android.app.Application
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth

/**
 * Holds a single SupabaseClient for the lifetime of the app process.
 *
 * Why: AuthManager used to call createSupabaseClient() on every worker run,
 * giving each run its own in-memory session object. The sign-in done in
 * MainActivity lived only on that instance; the worker's brand-new instance
 * had no session, so getRefreshedToken() always returned null and the upload
 * never made an HTTP request.
 *
 * With this class declared in AndroidManifest.xml the JVM creates it once per
 * process. MainActivity and EventUploadWorker both call AuthManager with the
 * same applicationContext, and AuthManager resolves it to this singleton —
 * meaning the session signed in via MainActivity is visible to the worker.
 */
class SpencareApplication : Application() {

    val supabaseClient: SupabaseClient by lazy {
        createSupabaseClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseKey = BuildConfig.SUPABASE_ANON_KEY,
        ) {
            install(Auth)
        }
    }
}
