package com.spencare.capture.ui

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.spencare.capture.R
import com.spencare.capture.auth.AuthManager
import com.spencare.capture.service.SpencareNotificationService
import kotlinx.coroutines.launch

/**
 * Main entry point for the Spencare Capture PoC app.
 *
 * This activity:
 *  1. Checks whether notification access has been granted.
 *  2. Enables the SpencareNotificationService component once access is granted.
 *  3. Shows the authentication status and a sign-in UI for the PoC.
 *
 * This is a minimal PoC UI, not the production design. The production
 * experience (Phase 3+) will integrate capture setup into the main Spencare
 * web app's settings screen, with the Android app deep-linking into it.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var authManager: AuthManager
    private lateinit var statusText: TextView
    private lateinit var grantButton: MaterialButton
    private lateinit var signInButton: MaterialButton

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        authManager = AuthManager(this)
        statusText = findViewById(R.id.tv_status)
        grantButton = findViewById(R.id.btn_grant_access)
        signInButton = findViewById(R.id.btn_sign_in)

        grantButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        signInButton.setOnClickListener {
            // PoC: prompts for email/password in a real dialog.
            // For initial testing, hardcode test credentials here or use
            // BuildConfig.DEBUG to load from a local config file.
            showSignInPrompt()
        }
    }

    override fun onResume() {
        super.onResume()
        lifecycleScope.launch { updateUi() }
    }

    /**
     * Refreshes auth state from the Supabase SDK before updating UI.
     * Must be called from a coroutine — getRefreshedToken() is suspend.
     *
     * Using getRefreshedToken() (not isSignedIn()) ensures the persisted
     * session is loaded from storage after a process restart. isSignedIn()
     * reads in-memory state only and returns false on a fresh instance.
     */
    private suspend fun updateUi() {
        val hasAccess = isNotificationAccessGranted()
        val isSignedIn = authManager.getRefreshedToken() != null

        if (!hasAccess) {
            statusText.text = "Notification access not granted.\nTap the button below to open Settings."
            grantButton.visibility = View.VISIBLE
        } else {
            enableNotificationService()
            statusText.text = if (isSignedIn) {
                "Capture active. Listening for financial notifications."
            } else {
                "Notification access granted. Please sign in to Spencare to start capturing."
            }
            grantButton.visibility = View.GONE
        }

        signInButton.visibility = if (!isSignedIn) View.VISIBLE else View.GONE
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

    private fun showSignInPrompt() {
        // PoC sign-in dialog. Phase 3 will replace with deep-link flow.
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
            addView(emailInput)
            addView(passwordInput)
        }

        android.app.AlertDialog.Builder(this)
            .setTitle("Sign in to Spencare")
            .setView(container)
            .setPositiveButton("Sign in") { _, _ ->
                val email = emailInput.text.toString()
                val password = passwordInput.text.toString()
                lifecycleScope.launch {
                    val ok = authManager.signInWithEmail(email, password)
                    statusText.text = if (ok) "Signed in." else "Sign-in failed. Check credentials."
                    updateUi()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
