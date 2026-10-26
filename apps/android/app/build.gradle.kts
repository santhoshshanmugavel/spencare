import java.net.URI
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Load local.properties so project.findProperty() works for arbitrary keys.
// The Android Gradle Plugin only reads sdk.dir automatically.
val localProps = Properties()
val localPropsFile = rootProject.file("local.properties")
if (localPropsFile.exists()) localPropsFile.inputStream().use { localProps.load(it) }
fun localProp(key: String): String = localProps.getProperty(key) ?: (project.findProperty(key) as String? ?: "")

android {
    namespace = "com.spencare.capture"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.spencare.capture"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Build-config fields — override via local.properties or CI secrets.
        // Never hard-code production values here.
        buildConfigField("String", "SUPABASE_URL", "\"${localProp("SUPABASE_URL")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${localProp("SUPABASE_ANON_KEY")}\"")
        buildConfigField("String", "CAPTURE_API_BASE_URL", "\"${localProp("CAPTURE_API_BASE_URL")}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Fail at configuration time if CAPTURE_API_BASE_URL is completely absent.
            // A blank URL in production would silently drop all capture events.
            val captureUrl = localProp("CAPTURE_API_BASE_URL")
            if (captureUrl.isBlank()) {
                throw GradleException(
                    "CAPTURE_API_BASE_URL must be set in local.properties for release builds. " +
                        "See apps/android/local.properties.example."
                )
            }
        }
    }

    // Reject development endpoints at release task execution time (not configuration
    // time, so debug tests are unaffected). HTTPS is required; http:// URLs include
    // all emulator (10.0.2.2), localhost, and LAN addresses.
    gradle.taskGraph.whenReady {
        val isReleaseBuild = allTasks.any { task ->
            task.project == project &&
                task.name.contains("Release", ignoreCase = true) &&
                !task.name.contains("Test", ignoreCase = true)
        }
        if (isReleaseBuild) {
            val captureUrl = localProp("CAPTURE_API_BASE_URL")
            // Structural URI parse — catches HTTPS-uppercase, no-host, localhost,
            // emulator (10.0.2.2), and common LAN addresses that startsWith("https://") misses.
            val uri = try { URI(captureUrl) } catch (_: Exception) { null }
            val scheme = uri?.scheme?.lowercase()
            val host = uri?.host?.lowercase() ?: ""
            // IPv4 loopback; IPv6 loopback — java.net.URI.getHost() KEEPS brackets: "[::1]"
            val devHosts = setOf("localhost", "127.0.0.1", "[::1]", "[0:0:0:0:0:0:0:1]")
            if (scheme != "https" || host.isBlank() || host in devHosts ||
                    host.endsWith(".local") || host.startsWith("192.168.") ||
                    host.startsWith("10.")) {
                throw GradleException(
                    "CAPTURE_API_BASE_URL must be a valid HTTPS URL with a public host for release builds. " +
                        "Got: '$captureUrl'. Development endpoints (http://, localhost, 127.0.0.1, " +
                        "10.x.x.x, 192.168.x.x, [::1], *.local) are not permitted. " +
                        "See apps/android/local.properties.example."
                )
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    testOptions {
        unitTests {
            // Prevent android.util.Log (and other Android SDK stubs) from
            // throwing RuntimeException in JVM unit tests.
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.supabase.gotrue)
    implementation(libs.supabase.postgrest)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.security.crypto)

    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlinx.coroutines.test)
    // Provides a real org.json implementation; the Android SDK jar mocks it in unit tests.
    testImplementation("org.json:json:20231013")
}
