package com.spencare.capture.receiver

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import com.spencare.capture.outbox.CaptureOutbox
import com.spencare.capture.service.SpencareNotificationService
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.mockkObject
import io.mockk.runs
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for BootCompletedReceiver — the boot-recovery path.
 *
 * Covers all 7 testable checks from the final reliability review:
 *  (1) non-BOOT_COMPLETED intents are ignored
 *  (2) empty outbox → no enqueue calls
 *  (3) N pending entries → N enqueue calls with correct data
 *  (4) title and body are always null (privacy policy)
 *  (5) malformed records cannot crash the receiver
 *  (6) markDone is never called — entries persist for WorkManager
 *  (7) applicationContext is used, not the raw broadcast context
 *
 * Not unit-testable:
 *  (8) ExistingWorkPolicy.KEEP prevents duplicate WorkManager jobs — requires
 *      Robolectric + WorkManager test infrastructure; covered by device/emulator QA.
 */
class BootCompletedReceiverTest {

    private val receiver = BootCompletedReceiver()
    private val prefs = FakeSharedPreferences()

    /** The applicationContext mock — also the context passed to enqueueCapture. */
    private val appContext: Context = mockk(relaxed = true) {
        every { applicationContext } returns this@mockk
        every { getSharedPreferences(CaptureOutbox.PREFS_NAME, Context.MODE_PRIVATE) } returns prefs
    }

    @After
    fun tearDown() { unmockkAll() }

    // ── Check 1: non-BOOT_COMPLETED intent is ignored ──────────────────────

    @Test
    fun `non-BOOT_COMPLETED intent is ignored`() {
        mockkObject(SpencareNotificationService.Companion)
        receiver.onReceive(appContext, mockIntent("android.intent.action.POWER_CONNECTED"))
        verify(exactly = 0) {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        }
    }

    // ── Check 2: empty outbox → no enqueue calls ────────────────────────────

    @Test
    fun `empty outbox produces no enqueue calls`() {
        mockkObject(SpencareNotificationService.Companion)
        receiver.onReceive(appContext, bootIntent())
        verify(exactly = 0) {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        }
    }

    // ── Check 3: N pending entries → N enqueue calls with correct data ──────

    @Test
    fun `two pending entries produce two enqueue calls with correct data`() {
        mockkObject(SpencareNotificationService.Companion)
        every {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        } just runs
        prefs.store["${CaptureOutbox.PREFIX}ref-001"] = "com.bank|2026-10-26T10:00:00Z|fp-001|Pixel 8"
        prefs.store["${CaptureOutbox.PREFIX}ref-002"] = "com.pay|2026-10-26T10:01:00Z|fp-002|Galaxy S24"

        receiver.onReceive(appContext, bootIntent())

        verify(exactly = 2) {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        }
        verify {
            SpencareNotificationService.enqueueCapture(
                appContext, "ref-001", "com.bank", null, null, "2026-10-26T10:00:00Z", "fp-001", "Pixel 8"
            )
        }
        verify {
            SpencareNotificationService.enqueueCapture(
                appContext, "ref-002", "com.pay", null, null, "2026-10-26T10:01:00Z", "fp-002", "Galaxy S24"
            )
        }
    }

    // ── Check 4: title and body are always null (privacy policy) ────────────

    @Test
    fun `enqueueCapture is always called with null title and body`() {
        mockkObject(SpencareNotificationService.Companion)
        every {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        } just runs
        prefs.store["${CaptureOutbox.PREFIX}ref-001"] = "com.bank|2026-10-26T10:00:00Z|fp-001|Pixel 8"

        receiver.onReceive(appContext, bootIntent())

        // title (arg 4) and body (arg 5) must be null — not stored in outbox
        verify {
            SpencareNotificationService.enqueueCapture(
                any(), any(), any(), isNull(), isNull(), any(), any(), any()
            )
        }
    }

    // ── Check 5: malformed records cannot crash the receiver ────────────────

    @Test
    fun `malformed outbox records are skipped and receiver does not throw`() {
        mockkObject(SpencareNotificationService.Companion)
        prefs.store["${CaptureOutbox.PREFIX}bad"] = "only_one_part"
        prefs.store["${CaptureOutbox.PREFIX}nullts"] = "com.test|null|fp-001|Device"

        receiver.onReceive(appContext, bootIntent())  // must not throw

        verify(exactly = 0) {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        }
    }

    // ── Check 6: markDone is never called — entries persist for WorkManager ─

    @Test
    fun `boot recovery does not call markDone — entries survive for WorkManager`() {
        mockkObject(SpencareNotificationService.Companion)
        every {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        } just runs
        prefs.store["${CaptureOutbox.PREFIX}ref-001"] = "com.bank|2026-10-26T10:00:00Z|fp-001|Pixel 8"

        receiver.onReceive(appContext, bootIntent())

        // Entry must still be in prefs — markDone() would have removed it
        assertTrue(prefs.store.containsKey("${CaptureOutbox.PREFIX}ref-001"))
    }

    // ── Check 7: applicationContext is used, not the raw broadcast context ──

    @Test
    fun `enqueueCapture receives applicationContext not the raw broadcast context`() {
        mockkObject(SpencareNotificationService.Companion)
        every {
            SpencareNotificationService.enqueueCapture(any(), any(), any(), any(), any(), any(), any(), any())
        } just runs
        prefs.store["${CaptureOutbox.PREFIX}ref-001"] = "com.bank|2026-10-26T10:00:00Z|fp-001|Pixel 8"
        val rawContext = mockk<Context>(relaxed = true) {
            every { applicationContext } returns appContext
        }

        receiver.onReceive(rawContext, bootIntent())

        // appContext (from rawContext.applicationContext) must be the context passed to enqueueCapture
        verify {
            SpencareNotificationService.enqueueCapture(
                appContext, any(), any(), any(), any(), any(), any(), any()
            )
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private fun bootIntent() = mockk<Intent> { every { action } returns Intent.ACTION_BOOT_COMPLETED }
    private fun mockIntent(action: String) = mockk<Intent> { every { this@mockk.action } returns action }

    // Minimal SharedPreferences fake — same pattern as CaptureOutboxTest
    private class FakeSharedPreferences : SharedPreferences {
        val store = mutableMapOf<String, Any?>()

        override fun getString(key: String, defValue: String?) = store[key] as? String ?: defValue
        override fun getAll(): MutableMap<String, *> = store.toMutableMap()
        override fun contains(key: String) = store.containsKey(key)
        override fun edit(): SharedPreferences.Editor = Editor()
        override fun getInt(key: String, defValue: Int) = defValue
        override fun getLong(key: String, defValue: Long) = defValue
        override fun getFloat(key: String, defValue: Float) = defValue
        override fun getBoolean(key: String, defValue: Boolean) = defValue
        override fun getStringSet(key: String, defValues: MutableSet<String>?) = defValues
        override fun registerOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener) {}
        override fun unregisterOnSharedPreferenceChangeListener(l: SharedPreferences.OnSharedPreferenceChangeListener) {}

        private inner class Editor : SharedPreferences.Editor {
            private val puts = mutableMapOf<String, Any?>()
            private val removes = mutableSetOf<String>()
            private var clearAll = false

            override fun putString(key: String, value: String?) = apply { puts[key] = value }
            override fun remove(key: String) = apply { removes.add(key) }
            override fun clear() = apply { clearAll = true }
            override fun commit(): Boolean { flush(); return true }
            override fun apply() { flush() }

            private fun flush() {
                if (clearAll) store.clear()
                removes.forEach { store.remove(it) }
                store.putAll(puts)
            }

            override fun putInt(key: String, value: Int) = this
            override fun putLong(key: String, value: Long) = this
            override fun putFloat(key: String, value: Float) = this
            override fun putBoolean(key: String, value: Boolean) = this
            override fun putStringSet(key: String, values: MutableSet<String>?) = this
        }
    }
}
