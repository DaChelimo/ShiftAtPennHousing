import java.util.Properties

// :androidApp — the Android (Jetpack Compose) front end. UI only; all state and
// behavior live in :shared.
plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.kotlinAndroid)
    alias(libs.plugins.compose.compiler)
    // Navigation 3 back stacks are persisted across process death by serializing their
    // NavKeys, so every destination type must be @Serializable.
    alias(libs.plugins.kotlinxSerialization)
}

// Firebase: apply Google Services only when google-services.json is present, so
// fresh clones / CI without the (gitignored, per-environment) file still build.
// With the file present it generates the google_app_id resources FCM needs and
// FirebaseApp auto-initializes; without it, token acquisition no-ops (guarded).
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.googleServices.get().pluginId)
} else {
    logger.warn("⚠ :androidApp — google-services.json not found; skipping Google Services plugin (FCM disabled).")
}

// Read local.properties so Android Studio's Run button picks up dev backend config
// without needing -P flags. local.properties is gitignored; values here are for
// local dev only.
val localProps = Properties().also { props ->
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { props.load(it) }
}
fun localOrGradle(key: String) = project.findProperty(key) as String? ?: localProps.getProperty(key) ?: ""

// Named environments. A device build must not depend on the Mac's current LAN IP, so the
// hosted projects get stable names instead of a single hand-edited SUPABASE_URL:
//
//   ./gradlew :androidApp:assembleDebug -PSUPABASE_ENV=staging
//
// resolves SUPABASE_URL_STAGING / SUPABASE_ANON_KEY_STAGING from local.properties (or a
// -P flag / CI secret). Recognised envs: LOCAL, STAGING, PROD.
//
// Precedence is deliberate and backwards-compatible:
//   1. an explicit -PSUPABASE_URL=… still wins outright (existing scripts keep working)
//   2. otherwise SUPABASE_ENV selects the suffixed key
//   3. otherwise empty -> the app runs on DemoData with no backend, which is what the
//      Maestro flows exercise. Never let a missing env silently resolve to a real project.
fun supabaseSetting(base: String): String {
    val explicit = localOrGradle(base)
    if (explicit.isNotEmpty()) return explicit

    val env = localOrGradle("SUPABASE_ENV")
    if (env.isEmpty()) return ""

    return localOrGradle("${base}_${env.uppercase()}")
}

android {
    namespace = "com.pennhousing.shift"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.pennhousing.shift"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        // Supabase config is injected at build time (gradle property / CI secret /
        // -PSUPABASE_URL=…). Empty by default → the app runs on DemoData with no
        // backend, which is what the Maestro flows exercise.
        buildConfigField("String", "SUPABASE_URL", "\"${supabaseSetting("SUPABASE_URL")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${supabaseSetting("SUPABASE_ANON_KEY")}\"")
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    testOptions {
        unitTests {
            // Robolectric needs resources/manifest on the JVM classpath.
            isIncludeAndroidResources = true
        }
    }
}

kotlin {
    jvmToolchain(17)
    // The shared models expose kotlin.time.Instant (still @ExperimentalTime in
    // Kotlin 2.2.x); the UI consumes it and reads the wall clock for `now`.
    compilerOptions {
        freeCompilerArgs.add("-opt-in=kotlin.time.ExperimentalTime")
    }
}

dependencies {
    implementation(projects.shared)

    // kotlinx-datetime — used by the Preferences deadline picker (LocalDate / TimeZone).
    // The shared API exposes kotlin.time.Instant; this compat build interops with it.
    implementation(libs.kotlinx.datetime)

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)

    // Navigation 3 — see ui/navigation/. Each bottom-nav destination owns its own
    // back stack, so switching tabs preserves per-tab state.
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)

    // Glance — home-screen widgets (Upcoming shifts). Mirrors the iOS ShiftWidgets target.
    implementation(libs.androidx.glance.appwidget)

    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    // Firebase Cloud Messaging — FCM token + push receipt (deliverable #6). The
    // Google Services plugin is applied conditionally above (only when
    // google-services.json is present); firebase-messaging compiles either way.
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.compose.ui.test.junit4)
}
