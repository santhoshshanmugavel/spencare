package com.spencare.capture.ui

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.spencare.capture.R
import com.spencare.capture.api.CaptureApiClient
import com.spencare.capture.auth.AuthManager
import com.spencare.capture.service.SpencareNotificationService
import kotlinx.coroutines.launch

/**
 * Main entry point for the Spencare Capture app.
 *
 * Handles three states:
 *   1. Not signed in — shows sign-in prompt.
 *   2. Signed in, notification access not granted — prompts for access.
 *   3. Signed in, access granted — enables the service, registers the device,
 *      shows capture-active confirmation.
 *
 * Device registration (POST /api/capture/device) is called each time the app
 * resumes so the server reflects the current notification-access state and
 * last-seen timestamp.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var authManager: AuthManager
    private lateinit var apiClient: CaptureApiClient
    private lateinit var statusText: TextView
    private lateinit var grantButton: MaterialButton
    private lateinit var signInButton: MaterialButton

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        authManager = AuthManager(this)
        apiClient = CaptureApiClient(getToken = { authManager.getRefreshedToken() })

        statusText = findViewById(R.id.tv_status)
        grantButton = findViewById(R.id.btn_grant_access)
        signInButton = findViewById(R.id.btn_sign_in)

        grantButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        signInButton.setOnClickListener {
            showSignInPrompt()
        }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch { updateUi() }
    }

    private suspend fun updateUi() {
        val hasAccess = isNotificationAccessGranted()
        val token = authManager.getRefreshedToken()
        val isSignedIn = token != null

        when {
            !isSignedIn -> {
                statusText.text = "Sign in to your Spencare account to start capturing financial notifications."
                grantButton.visibility = View.GONE
                signInButton.visibility = View.VISIBLE
            }
            !hasAccess -> {
                statusText.text = "Grant notification access so Spencare can capture financial notifications from your banking apps."
                grantButton.visibility = View.VISIBLE
                signInButton.visibility = View.GONE
                enableNotificationService()
            }
            else -> {
                enableNotificationService()
                statusText.text = "Capture is active. Financial notifications from your banking apps will appear in Spencare for review."
                grantButton.visibility = View.GONE
                signInButton.visibility = View.GONE
                registerDeviceInBackground(hasAccess)
            }
        }
    }

    private fun registerDeviceInBackground(notificationAccessGranted: Boolean) {
        lifecycleScope.launch {
            try {
                apiClient.registerDevice(
                    deviceFingerprint = getDeviceFingerprint(),
                    deviceName = getDeviceDisplayName(),
                    notificationAccessGranted = notificationAccessGranted,
                )
            } catch (_: Exception) {
                // Non-fatal — capture works without a registered device ID.
            }
        }
    }

    private fun isNotificationAccessGranted(): Boolean {
        val pkgName = packageName
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        if (!TextUtils.isEmpty(flat)) {
            flat.split(":").forEach { component ->
                val cn = ComponentName.unflattenFromString(component)
                if (cn != null && pkgName == cn.packageName) return true
            }
        }
        return false
    }

    private fun enableNotificationService() {
        val component = ComponentName(this, SpencareNotificationService::class.java)
        packageManager.setComponentEnabledSetting(
            component,
            android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            android.content.pm.PackageManager.DONT_KILL_APP,
        )
    }

    private fun getDeviceFingerprint(): String {
        val prefs = getSharedPreferences("spencare_device", Context.MODE_PRIVATE)
        val existing = prefs.getString("fingerprint", null)
        if (existing != null) return existing
        val generated = java.util.UUID.randomUUID().toString()
        prefs.edit().putString("fingerprint", generated).apply()
        return generated
    }

    private fun getDeviceDisplayName(): String {
        val manufacturer = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        val model = Build.MODEL
        return if (model.startsWith(manufacturer, ignoreCase = true)) model else "$manufacturer $model"
    }

    private fun showSignInPrompt() {
        val emailInput = android.widget.EditText(this).apply {
            hint = "Email"
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        }
        val passwordInput = android.widget.EditText(this).apply {
            hint = "Password"
            inputType = android.text.InputType.TYPE_CLASS_TEXT or
                    android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val container = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            val pad = (16 * resources.displayMetrics.density).toInt()
            setPadding(pad, pad, pad, 0)
            addView(emailInput)
            addView(passwordInput)
        }

        android.app.AlertDialog.Builder(this)
            .setTitle("Sign in to Spencare")
            .setView(container)
            .setPositiveButton("Sign in") { _, _ ->
                val email = emailInput.text.toString().trim()
                val password = passwordInput.text.toString()
                if (email.isEmpty() || password.isEmpty()) {
                    statusText.text = "Enter your email and password."
                    return@setPositiveButton
                }
                lifecycleScope.launch {
                    statusText.text = "Signing in…"
                    val ok = authManager.signInWithEmail(email, password)
                    if (ok) {
                        updateUi()
                    } else {
                        statusText.text = "Sign-in failed. Check your email and password and try again."
                        signInButton.visibility = View.VISIBLE
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
