# Android: Robolectric + Compose UI Testing

`androidApp/src/test/` (the JVM unit-test source set) does not exist yet in this repo — no test
file, no Robolectric dependency. `androidApp/src/androidTest/` already has `androidx.espresso.core`
and `compose.ui.test.junit4` as dependencies but is empty; those deps stay there for the rare real-device
fallback (see SKILL.md Step 2) but are not what this reference sets up.

## First-time setup (do this once; skip if `androidApp/src/test/` already has Robolectric tests)

### 1. Add the Robolectric dependency to the version catalog

`apps/mobile/gradle/libs.versions.toml` already declares `androidx-test-junit`, `androidx-test-runner`,
`androidx-test-core`, `androidx-espresso` under `[versions]` and their `androidTestImplementation`
aliases under `[libraries]` (see lines ~23-27, ~65-69). Add a `robolectric` version + library entry
following that same pattern:

```toml
# [versions]
robolectric = "4.14"   # check https://github.com/robolectric/robolectric/releases for current stable

# [libraries]
robolectric = { module = "org.robolectric:robolectric", version.ref = "robolectric" }
```

### 2. Wire it into `androidApp/build.gradle.kts`

Add alongside the existing `testImplementation(libs.junit)` line (~line 107):

```kotlin
testImplementation(libs.robolectric)
testImplementation(libs.androidx.test.ext.junit)
testImplementation(libs.androidx.test.core)
testImplementation(libs.compose.ui.test.junit4)
debugImplementation(libs.compose.ui.test.manifest) // already present; Robolectric reuses it
```

And add a `testOptions` block inside the existing `android { ... }` block (near `packaging { ... }`):

```kotlin
testOptions {
    unitTests {
        isIncludeAndroidResources = true // Robolectric needs resources/manifest on the JVM classpath
        isReturnDefaultValues = true
    }
}
```

### 3. Confirm it runs

`./gradlew :androidApp:testDebugUnitTest` should now discover and run tests placed under
`androidApp/src/test/java/com/pennhousing/shift/...` (mirror the `androidTest` package layout).

## Writing a test

Use `createAndroidComposeRule<ComponentActivity>()` (or a Robolectric `@RunWith(RobolectricTestRunner::class)`

- `createComposeRule()`, whichever the specific screen needs — a screen that reads a real Activity
  context/lifecycle needs the former). Drive the screen exactly as a user would, asserting only through
  `testTag`:

```kotlin
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34]) // Robolectric needs an explicit SDK; match compileSdk unless a specific API matters
class ShiftTourScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `range step advances summary on drag`() {
        composeRule.setContent { ShiftTourScreen(viewModel = fakeViewModel()) }

        composeRule.onNodeWithTag("shift_tour_range").performTouchInput {
            swipeRight(startX = left, endX = right)
        }

        composeRule.onNodeWithTag("shift_tour_summary")
            .assertTextEquals("8:00 AM – 4:00 PM")
    }
}
```

Key points, all from SKILL.md Step 2 but concrete here:

- Always resolve nodes via `onNodeWithTag("...")`, matching the exact string already used in the
  Composable's `.testTag(...)` modifier — never invent a new tag or match on displayed text unless
  the control genuinely has no tag (flag that as a gap instead of working around it).
- A drag/hold gesture is exercised with `performTouchInput { swipe... / down(...) ; advanceEventTime(...) ; up() }`,
  not just `assertExists()`.
- Feed the real `ShiftTourViewModel` (or the relevant screen's real ViewModel) a fake/in-memory
  dependency, not a hand-rolled screen-only stub — the whole point of the KMP split is that the
  ViewModel logic is already tested in `:shared`; the Compose test's job is to prove the screen wires
  up to it correctly, including gestures.

## When Robolectric genuinely isn't enough

Real examples where the JVM shadow layer doesn't behave like a device: Glance/AppWidget rendering,
anything reading real GPU-backed `Canvas` pixel output, certain `WindowInsets`/multi-window behavior.
If you hit one, write the test in `androidApp/src/androidTest/` instead and put a one-line comment
at the top of the test file naming the specific Robolectric limitation — not a general "instrumented
tests are more thorough" justification.
