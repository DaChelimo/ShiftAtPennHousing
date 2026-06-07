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

## Phase 13a — worker Shifts screen

The SwiftUI worker app lives in these target sources (add all to the Xcode app
target — *File ▸ Add Files*):

| File                            | Role                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `iOSApp.swift`                  | `@main`; installs `AppDelegate`; hosts `ShiftsRootView`.             |
| `ContentView.swift`             | `ShiftsRootView` — the §5.6 three-tab screen + Updates tab.          |
| `FloatAcknowledgmentView.swift` | The §7 float ack/decline modal.                                      |
| `AppDelegate.swift`             | Notification authorization, APNs registration, FCM-token forwarding. |

All decision logic is in the shared `ShiftsScreenViewModel` / `AckDeclineViewModel`
(exported to the `Shared` framework). SKIE exposes their `StateFlow<…UiState>` so
the `@MainActor` `ObservableObject` wrappers (`ShiftsObservable` / `AckObservable`)
can `for await` the state into a `@Published` property. `DemoFactory` builds the
demo ViewModels so Swift never constructs a `kotlin.time.Instant`.

The screens expose the `accessibilityIdentifier`s in `apps/mobile/maestro/README.md`
so the **same** Maestro flows run on the simulator.

## Reskin foundation (Theme + Kit + fonts)

The visual foundation (design-token theme + shared component kit) lives in:

| Path | Role |
| ---- | ---- |
| `iosApp/iosApp/Theme/ShiftTheme.swift` | Color tokens (light/dark), IBM Plex type ramp (Dynamic Type), spacing/radii/motion, SF-Symbol icon map. |
| `iosApp/iosApp/Kit/ShiftComponents.swift` | Buttons, shift-state pills + legend, the canonical Shift Card + atoms, open-shift card. |
| `iosApp/iosApp/Kit/ShiftRowsControls.swift` | Section header/container, key-value row, segmented control, toggle, bottom sheet + confirm. |
| `iosApp/iosApp/Kit/ShiftChromeFeedback.swift` | Large-title header, `TabView` tab bar, icon button, avatar, toast, banner, countdown, badge, empty state, skeleton. |
| `iosApp/iosApp/Kit/ShiftGallery.swift` | `#Preview` catalog of the whole kit (light + dark) — not shipped. |
| `iosApp/iosApp/Fonts/IBMPlex*.ttf` | Bundled IBM Plex Sans/Mono weights (OFL-1.1, see `Fonts/OFL.txt`). |

Add all of `Theme/`, `Kit/`, and the `Fonts/*.ttf` to the app target (*File ▸ Add
Files*). `Info.plist` already declares `UIAppFonts` for the seven weights; until the
`.ttf` are added to the target the theme falls back to **SF Pro** (graceful). The
foundation reconciles the `--tk-*` tokens from `apps/mobile/design/worker-app.html`
— canonical reference: `apps/mobile/design/DESIGN_TOKENS.md`. Feature screens are
reskinned in a later step; `ContentView.swift` / `FloatAcknowledgmentView.swift` are
unchanged by the foundation.

## Push notifications (deliverable #6)

1. **Add the Firebase SDK via SPM** (*File ▸ Add Package Dependencies*):
   `https://github.com/firebase/firebase-ios-sdk` → add **FirebaseMessaging**
   (pulls **FirebaseCore**). `AppDelegate` guards Firebase with `#if canImport(...)`,
   so the app builds before the package is added — only FCM-token forwarding is
   gated until then.
2. **Add `GoogleService-Info.plist`** (from the Firebase console) to the target.
3. **Enable capabilities** on the target: **Push Notifications** and
   **Background Modes ▸ Remote notifications** (`Info.plist` already declares the
   `remote-notification` background mode). The APNs entitlement is added with the
   Push Notifications capability.
4. iOS registers the **Firebase FCM token** (not the raw APNs token) with
   `register-push-token`, platform `"ios"` — Firebase routes APNs (AGENTS phase-12).

## Supabase config

`Configuration/Config.xcconfig` defines `SUPABASE_URL` / `SUPABASE_ANON_KEY`,
surfaced into `Info.plist` and read by `AppDelegate` into the shared `AppConfig`
(the iOS analogue of Android `BuildConfig`). Empty by default → the app runs on
`DemoData` with no backend.
