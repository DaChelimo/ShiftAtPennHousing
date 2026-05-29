# iosApp — SwiftUI front end

The iOS app consumes the Kotlin Multiplatform `:shared` module as a framework
named **`Shared`** (`import Shared`). Like Google's Fruitties sample, UI is
native (SwiftUI) and all state/logic lives in `:shared`.

These Swift sources + `Info.plist` + `Configuration/Config.xcconfig` are checked
in; the **Xcode project and code-signing are set up on your machine** (the
`.xcodeproj` is intentionally not committed yet). Two ways to get an app target:

## Option A — generate with the KMP/Xcode wizard (recommended)
Use Android Studio's *Kotlin Multiplatform* wizard or `kdoctor`-verified Xcode
new-project flow, then drop these `iosApp/iosApp/*.swift` files in.

## Option B — create a SwiftUI app target manually
1. In Xcode: **File ▸ New ▸ Project ▸ iOS App** (SwiftUI), save into `apps/mobile/iosApp/`.
2. Add `iosApp/iosApp/*.swift` and `Info.plist` to the target; set the config
   file to `Configuration/Config.xcconfig`.
3. Set **Bundle Identifier** `com.pennhousing.shift`, **Display Name**
   "Shift PennHousing", and your signing **Team**.
4. Add a **Run Script** build phase (before *Compile Sources*) that builds and
   embeds the shared framework:
   ```sh
   cd "$SRCROOT/.."
   ./gradlew :shared:embedAndSignAppleFrameworkForXcode
   ```
5. Set **Framework Search Paths** to:
   ```
   $(SRCROOT)/../shared/build/xcode-frameworks/$(CONFIGURATION)/$(SDK_NAME)
   ```
6. Link the **`Shared`** framework (Embed & Sign).

## Building the shared framework from Gradle
```sh
# Simulator (Apple silicon)
./gradlew :shared:linkDebugFrameworkIosSimulatorArm64
# Device
./gradlew :shared:linkDebugFrameworkIosArm64
```
Requires Xcode + command-line tools. The framework `baseName` is `Shared`
(see `shared/build.gradle.kts`).

## Wiring the shared ViewModel (next step)
`shared` exposes `MainViewModel` (an `androidx.lifecycle.ViewModel` with a
`StateFlow<MainUiState>`), exported to the framework. SKIE makes the `StateFlow`
observable in SwiftUI — see the Fruitties sample's `Observing`/
`ViewModelStoreOwnerProvider` helpers for the canonical pattern.
