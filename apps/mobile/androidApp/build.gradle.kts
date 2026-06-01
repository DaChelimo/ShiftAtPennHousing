// :androidApp — the Android (Jetpack Compose) front end. UI only; all state and
// behavior live in :shared.
plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.kotlinAndroid)
    alias(libs.plugins.compose.compiler)
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
        buildConfigField("String", "SUPABASE_URL", "\"${project.findProperty("SUPABASE_URL") ?: ""}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${project.findProperty("SUPABASE_ANON_KEY") ?: ""}\"")
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

    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    // Firebase Cloud Messaging — FCM token + push receipt (deliverable #6). The
    // Google Services plugin is applied conditionally above (only when
    // google-services.json is present); firebase-messaging compiles either way.
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.espresso.core)
    androidTestImplementation(libs.compose.ui.test.junit4)
}
