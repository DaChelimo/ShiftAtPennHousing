enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

// No spaces: rootProject.name must match [a-zA-Z]([A-Za-z0-9-_])* for
// TYPESAFE_PROJECT_ACCESSORS (projects.shared). The user-facing app name lives
// in androidApp strings.xml (@string/app_name = "SHIFT").
rootProject.name = "Shift"
include(":shared")
include(":androidApp")
