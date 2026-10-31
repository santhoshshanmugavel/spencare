package com.spencare.capture.auth

import android.content.Context
import com.spencare.capture.SpencareApplication
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.SessionStatus
import io.github.jan.supabase.gotrue.auth
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class AuthManagerTest {

    @Before
    fun setUp() {
        // SupabaseClient.auth is a Kotlin extension property compiled to a static getter
        // in AuthKt. MockK cannot intercept it without mockkStatic.
        mockkStatic("io.github.jan.supabase.gotrue.AuthKt")
    }

    @After
    fun tearDown() {
        unmockkStatic("io.github.jan.supabase.gotrue.AuthKt")
    }

    /**
     * Builds an AuthManager backed by a mock SupabaseClient.
     *
     * [statusFlow] controls the SessionStatus the fake SDK emits.
     * [token] is what currentSessionOrNull() returns (null = no session).
     * [timeoutMs] is set short so timeout tests don't block for real seconds.
     */
    private fun makeManager(
        statusFlow: MutableStateFlow<SessionStatus>,
        token: String?,
        timeoutMs: Long = 500L,
        refreshThrows: Throwable? = null,
    ): AuthManager {
        val mockAuth = mockk<Auth>(relaxed = true)
        every { mockAuth.sessionStatus } returns statusFlow
        if (refreshThrows != null) {
            coEvery { mockAuth.refreshCurrentSession() } throws refreshThrows
        } else {
            coEvery { mockAuth.refreshCurrentSession() } returns Unit
        }
        coEvery { mockAuth.currentSessionOrNull() } returns token?.let { t ->
            mockk(relaxed = true) { every { accessToken } returns t }
        }

        val mockClient = mockk<SupabaseClient>()
        // .auth is a static extension (AuthKt.getAuth); mockkStatic is required (set in @Before).
        every { mockClient.auth } returns mockAuth

        return AuthManager(
            context = mockk<Context>(relaxed = true),
            clientOverride = mockClient,
            sessionTimeoutMs = timeoutMs,
        )
    }

    @Test
    fun `already authenticated returns token`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.Authenticated(mockk(relaxed = true)))
        val manager = makeManager(flow, "tok-aaa")
        assertNotNull(manager.getRefreshedToken())
    }

    @Test
    fun `LoadingFromStorage then Authenticated returns token`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.LoadingFromStorage)
        val manager = makeManager(flow, "tok-bbb")
        launch { flow.value = SessionStatus.Authenticated(mockk(relaxed = true)) }
        assertNotNull(manager.getRefreshedToken())
    }

    @Test
    fun `LoadingFromStorage then NotAuthenticated returns null`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.LoadingFromStorage)
        val manager = makeManager(flow, null)
        launch { flow.value = SessionStatus.NotAuthenticated(isSignOut = false) }
        assertNull(manager.getRefreshedToken())
    }

    @Test
    fun `timeout while stuck in LoadingFromStorage returns null`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.LoadingFromStorage)
        // Never transitions; 500 ms virtual-time timeout fires.
        val manager = makeManager(flow, null, timeoutMs = 500L)
        assertNull(manager.getRefreshedToken())
    }

    @Test
    fun `cancellation is propagated not swallowed`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.LoadingFromStorage)
        val manager = makeManager(flow, null)
        val job = launch {
            try {
                manager.getRefreshedToken()
            } catch (e: CancellationException) {
                // expected — test passes if we reach here without an assertion failure
                throw e
            }
        }
        job.cancel()
        job.join()
        assert(job.isCancelled)
    }

    @Test
    fun `no session returns null`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.Authenticated(mockk(relaxed = true)))
        val manager = makeManager(flow, null)
        assertNull(manager.getRefreshedToken())
    }

    // Phase 2 reliability fix (H2): if refreshCurrentSession() itself fails (e.g. revoked session),
    // getRefreshedToken() must return null — not the stale token that would produce repeated 401s.
    @Test
    fun `refresh failure returns null not stale token`() = runTest {
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.Authenticated(mockk(relaxed = true)))
        val manager = makeManager(flow, token = "stale-token", refreshThrows = RuntimeException("session revoked"))
        assertNull(manager.getRefreshedToken())
    }

    // Regression: AuthManager must use the Application singleton so Worker shares the session
    // from the sign-in done in MainActivity, not its own isolated in-memory client.
    @Test
    fun `uses SpencareApplication singleton client when no clientOverride`() = runTest {
        val mockAuth = mockk<Auth>(relaxed = true)
        val flow = MutableStateFlow<SessionStatus>(SessionStatus.Authenticated(mockk(relaxed = true)))
        every { mockAuth.sessionStatus } returns flow
        coEvery { mockAuth.refreshCurrentSession() } returns Unit
        coEvery { mockAuth.currentSessionOrNull() } returns mockk(relaxed = true) {
            every { accessToken } returns "singleton-tok"
        }

        val mockClient = mockk<SupabaseClient>()
        every { mockClient.auth } returns mockAuth

        val mockApp = mockk<SpencareApplication>(relaxed = true)
        every { mockApp.applicationContext } returns mockApp
        every { mockApp.supabaseClient } returns mockClient

        val manager = AuthManager(context = mockApp, sessionTimeoutMs = 500L)
        val token = manager.getRefreshedToken()
        assertNotNull("Worker must see session from Application singleton", token)
    }
}
