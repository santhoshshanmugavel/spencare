package com.spencare.capture.outbox

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for CaptureOutbox — the SharedPreferences-backed outbox that
 * eliminates the process-death window before WorkManager enqueue.
 *
 * Tests the 9 scenarios required by the ATC Durable Capture spec:
 *  (1) eligible event persisted
 *  (2) duplicate sourceRefId idempotency
 *  (3) process restart / pendingEntries
 *  (4) successful upload + delivery marking
 *  (5) server duplicate response
 *  (6) retryable failure — entry survives
 *  (7) terminal failure + no stuck entries
 *  (8) distinct entries for distinct sourceRefIds
 *  (9) selective deletion / retention
 */
class CaptureOutboxTest {

    private val prefs = FakeSharedPreferences()
    private val outbox = CaptureOutbox(prefs)

    // ── Scenario 1: eligible event persisted before scheduling ───────────────

    @Test
    fun `save persists pending entry with expected fields`() {
        outbox.save("ref-001", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Pixel 8")
        val entries = outbox.pendingEntries()
        assertEquals(1, entries.size)
        entries[0].run {
            assertEquals("ref-001", sourceRefId)
            assertEquals("com.test", packageName)
            assertEquals("2026-10-26T10:00:00Z", deviceReceivedAt)
            assertEquals("fp-001", deviceFingerprint)
            assertEquals("Pixel 8", deviceName)
        }
    }

    // ── Scenario 2: duplicate sourceRefId → idempotent ──────────────────────

    @Test
    fun `save twice with same sourceRefId produces one entry`() {
        outbox.save("ref-001", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        outbox.save("ref-001", "com.test", "2026-10-26T10:00:01Z", "fp-001", "Device")
        assertEquals(1, outbox.pendingEntries().size)
    }

    // ── Scenario 3: process restart — pendingEntries returns saved events ────

    @Test
    fun `pendingEntries returns all saved entries after simulated restart`() {
        outbox.save("ref-001", "com.a", "2026-10-26T10:00:00Z", "fp-001", "Device")
        outbox.save("ref-002", "com.b", "2026-10-26T10:01:00Z", "fp-001", "Device")
        // A new CaptureOutbox backed by the same prefs simulates process restart
        val recovered = CaptureOutbox(prefs)
        val entries = recovered.pendingEntries()
        assertEquals(2, entries.size)
        val ids = entries.map { it.sourceRefId }.toSet()
        assertEquals(setOf("ref-001", "ref-002"), ids)
    }

    // ── Scenario 4: successful upload + delivery marking ────────────────────

    @Test
    fun `markDone removes entry after successful upload`() {
        outbox.save("ref-001", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        outbox.markDone("ref-001")
        assertTrue(outbox.pendingEntries().isEmpty())
    }

    // ── Scenario 5: server duplicate response treated as success ────────────

    @Test
    fun `markDone removes entry after server duplicate response`() {
        outbox.save("ref-dup", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        // Worker receives duplicate=true, treats it as success, calls markDone
        outbox.markDone("ref-dup")
        assertTrue(outbox.pendingEntries().isEmpty())
    }

    // ── Scenario 6: retryable failure — entry must survive for reboot recovery

    @Test
    fun `pending entry survives retryable failure when markDone is not called`() {
        outbox.save("ref-retry", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        // Worker returns Result.retry() without calling markDone — entry must remain
        val entries = outbox.pendingEntries()
        assertEquals(1, entries.size)
        assertEquals("ref-retry", entries[0].sourceRefId)
    }

    // ── Scenario 7: terminal failure + no stuck PENDING entries ─────────────

    @Test
    fun `markDone removes entry after terminal failure preventing infinite re-enqueue`() {
        outbox.save("ref-terminal", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        // Worker returns Result.failure() after HTTP 400 / retry exhaustion
        outbox.markDone("ref-terminal")
        assertTrue(outbox.pendingEntries().isEmpty())
    }

    // ── Scenario 8: distinct entries for distinct sourceRefIds ──────────────

    @Test
    fun `two different sourceRefIds create two distinct entries`() {
        outbox.save("ref-001", "com.a", "2026-10-26T10:00:00Z", "fp-001", "Device")
        outbox.save("ref-002", "com.b", "2026-10-26T10:01:00Z", "fp-001", "Device")
        val entries = outbox.pendingEntries()
        assertEquals(2, entries.size)
        val ids = entries.map { it.sourceRefId }.toSet()
        assertEquals(setOf("ref-001", "ref-002"), ids)
    }

    // ── Scenario 9: selective deletion — other entries are retained ──────────

    @Test
    fun `markDone for one entry leaves other entries intact`() {
        outbox.save("ref-001", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        outbox.save("ref-002", "com.test", "2026-10-26T10:01:00Z", "fp-001", "Device")
        outbox.markDone("ref-001")
        val remaining = outbox.pendingEntries()
        assertEquals(1, remaining.size)
        assertEquals("ref-002", remaining[0].sourceRefId)
    }

    // ── Null / optional field handling ───────────────────────────────────────

    @Test
    fun `nullable fields survive round-trip through outbox`() {
        outbox.save("ref-null", null, "2026-10-26T10:00:00Z", null, null)
        val entry = outbox.pendingEntries().single()
        assertEquals(null, entry.packageName)
        assertEquals(null, entry.deviceFingerprint)
        assertEquals(null, entry.deviceName)
    }

    // ── Phase 3 review: new integrity tests ──────────────────────────────────

    // Phase 2 finding #1: save() must return the commit() Boolean so callers
    // can detect disk-write failure and log accordingly.
    @Test
    fun `save returns false when commit fails`() {
        val failingOutbox = CaptureOutbox(FakeSharedPreferences(commitResult = false))
        val result = failingOutbox.save("ref-fail", "com.test", "2026-10-26T10:00:00Z", "fp-001", "Device")
        assertFalse(result)
    }

    // Phase 2 finding #2: malformed entry with too few fields must be silently skipped.
    @Test
    fun `malformed entry with too few pipe-separated fields is skipped`() {
        prefs.store["pending_bad"] = "only_one_field_no_separator"
        assertTrue(outbox.pendingEntries().isEmpty())
    }

    // Phase 2 finding #2: entry where deviceReceivedAt is the literal "null" must be skipped
    // to avoid sending a corrupt ISO timestamp to the server.
    @Test
    fun `entry with null deviceReceivedAt string is skipped`() {
        // Value with "null" in the timestamp position (parts[1])
        prefs.store["pending_badts"] = "com.test|null|fp-001|Pixel 8"
        assertTrue(outbox.pendingEntries().isEmpty())
    }

    // ── FakeSharedPreferences ────────────────────────────────────────────────

    private class FakeSharedPreferences(private val commitResult: Boolean = true) : SharedPreferences {
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
            override fun commit(): Boolean { flush(); return commitResult }
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
