// :shared — the Kotlin Multiplatform business-logic module consumed by the
// Android (:androidApp, Jetpack Compose) and iOS (iosApp, SwiftUI via SKIE) apps.
// Structure follows Google's Fruitties sample: shared logic, native UI per platform.
plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.androidKmpLibrary)
    alias(libs.plugins.kotlinxSerialization)
    alias(libs.plugins.skie)
}

kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xexpect-actual-classes")
    }

    // Android target via the AGP KMP library plugin.
    androidLibrary {
        namespace = "com.pennhousing.shift.shared"
        compileSdk = 36
        minSdk = 24

        // Enables JVM-host unit tests so commonTest runs without an emulator/Xcode.
        withHostTestBuilder {}
    }

    // iOS targets. The Xcode app (iosApp/) links the generated `Shared` framework.
    // Building these requires Xcode; the Android build does not run their tasks.
    listOf(
        iosX64(),
        iosArm64(),
        iosSimulatorArm64(),
    ).forEach {
        it.binaries.framework {
            export(libs.androidx.lifecycle.viewmodel)
            baseName = "Shared"
            binaryOption("bundleId", "com.pennhousing.shift.shared")
        }
    }

    sourceSets {
        all {
            languageSettings.optIn("kotlin.experimental.ExperimentalObjCName")
            // kotlin.time.Instant is the modern instant type (kotlinx.datetime.Instant
            // is deprecated in 0.7.x); it is still @ExperimentalTime in Kotlin 2.2.x.
            languageSettings.optIn("kotlin.time.ExperimentalTime")
        }
        commonMain {
            dependencies {
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.core)
                implementation(libs.kotlinx.datetime)
                // api + export so the shared ViewModel base is visible in Swift.
                api(libs.androidx.lifecycle.viewmodel)
                implementation(libs.skie.annotations)
            }
        }
        commonTest {
            dependencies {
                implementation(libs.kotlin.test)
                implementation(libs.kotlinx.coroutines.test)
            }
        }
        androidMain {
            dependencies {
                // Android-only deps go here (e.g. an OkHttp Ktor engine, later).
            }
        }
        iosMain {
            dependencies {
                // iOS-only deps go here (e.g. a Darwin Ktor engine, later).
            }
        }
    }
}

skie {
    analytics {
        enabled.set(false)
    }
}
