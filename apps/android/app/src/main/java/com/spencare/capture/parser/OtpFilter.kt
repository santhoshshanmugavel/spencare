package com.spencare.capture.parser

/**
 * OTP detection filter — mirrors the server-side containsOtp() function in
 * packages/domain/core/src/notificationParser.ts.
 *
 * This on-device pre-filter prevents OTP text from ever leaving the device.
 * The server runs the same check again as a second line of defence.
 *
 * Any change to these patterns MUST be mirrored in notificationParser.ts and
 * the server MUST be deployed before shipping an Android update that removes
 * a pattern (fail-safe: server filters more conservatively than client).
 */
object OtpFilter {

    private val OTP_PATTERNS = listOf(
        Regex("\\botp\\b", RegexOption.IGNORE_CASE),
        Regex("\\bone.?time.?pass(?:word|code)?\\b", RegexOption.IGNORE_CASE),
        Regex("\\bpasscode\\b", RegexOption.IGNORE_CASE),
        Regex("\\bverification.?code\\b", RegexOption.IGNORE_CASE),
        Regex("\\bdo not share\\b", RegexOption.IGNORE_CASE),
        Regex("\\bdo not disclose\\b", RegexOption.IGNORE_CASE),
        Regex("\\bis your.{0,20}(?:otp|pin|code|password)\\b", RegexOption.IGNORE_CASE),
        Regex("\\b(?:otp|pin|code)\\s*:\\s*\\d{4,8}\\b", RegexOption.IGNORE_CASE),
        Regex("\\buse\\s+\\d{4,8}\\s+(?:to|as)\\b", RegexOption.IGNORE_CASE),
    )

    fun containsOtp(text: String): Boolean = OTP_PATTERNS.any { it.containsMatchIn(text) }

    fun containsOtp(title: String, body: String): Boolean =
        containsOtp("$title\n$body")
}
