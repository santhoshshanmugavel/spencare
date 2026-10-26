package com.spencare.capture.outbox

import android.content.Context
import android.content.SharedPreferences

/**
 * SharedPreferences-backed outbox for pending capture events.
 *
 * Eliminates the process-death window between notification receipt and
 * WorkManager enqueue. save() uses commit() (synchronous) — the write is
 * flushed to disk before the method returns, so a process kill immediately
 * after save() leaves a recoverable entry.
 *
 * shortcut: no structured schema; suitable for the current flat layout,
 * upgrade to Room if multi-table queries or migration paths are needed.
 */
class CaptureOutbox(private val prefs: SharedPreferences) {

    /**
     * Persists a pending event synchronously before WorkManager enqueue.
     * Idempotent — a second save for the same sourceRefId overwrites the first.
     * title/body are intentionally excluded to avoid storing raw notification text.
     *
     * Returns true if the write was confirmed to disk, false on failure.
     * Callers MUST check the return value — a false result means the event
     * is NOT durable and will not survive process death.
     */
    fun save(
        sourceRefId: String,
        packageName: String?,
        deviceReceivedAt: String,
        deviceFingerprint: String?,
        deviceName: String?,
    ): Boolean =
        prefs.edit()
            .putString(
                prefKey(sourceRefId),
                "$packageName$SEP$deviceReceivedAt$SEP$deviceFingerprint$SEP$deviceName",
            )
            .commit()

    /**
     * Removes the outbox entry after any terminal outcome — success, duplicate,
     * or permanent failure. Called asynchronously (apply) because the event has
     * already left the loss window; a second delivery on the next restart is a
     * harmless duplicate that the server deduplicates via sourceRefId.
     *
     * NOT called on retry — the entry must survive for reboot recovery.
     */
    fun markDone(sourceRefId: String) {
        prefs.edit().remove(prefKey(sourceRefId)).apply()
    }

    /**
     * Returns all pending entries for re-enqueue after process restart.
     * Each entry carries only non-sensitive metadata; title/body are absent.
     */
    fun pendingEntries(): List<PendingEntry> =
        prefs.all.entries.mapNotNull { (key, value) ->
            if (!key.startsWith(PREFIX)) return@mapNotNull null
            val parts = (value as? String)?.split(SEP) ?: return@mapNotNull null
            if (parts.size < 4) return@mapNotNull null
            // Guard: deviceReceivedAt must be a real ISO string, not the literal "null".
            // A stored "null" means the field was missing at write time; skip to avoid
            // sending a corrupt payload that would fail server-side validation.
            val deviceReceivedAt = parts[1].takeIf { it != "null" } ?: return@mapNotNull null
            PendingEntry(
                sourceRefId = key.removePrefix(PREFIX),
                packageName = parts[0].takeIf { it != "null" },
                deviceReceivedAt = deviceReceivedAt,
                deviceFingerprint = parts[2].takeIf { it != "null" },
                deviceName = parts[3].takeIf { it != "null" },
            )
        }

    data class PendingEntry(
        val sourceRefId: String,
        val packageName: String?,
        val deviceReceivedAt: String,
        val deviceFingerprint: String?,
        val deviceName: String?,
    )

    private fun prefKey(sourceRefId: String) = "$PREFIX$sourceRefId"

    companion object {
        const val PREFS_NAME = "capture_outbox"
        const val PREFIX = "pending_"
        private const val SEP = "|"

        fun from(context: Context): CaptureOutbox =
            CaptureOutbox(context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE))
    }
}
