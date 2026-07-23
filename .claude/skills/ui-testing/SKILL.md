---
name: ui-testing
description: Write, verify, and commit automated UI tests for the Shift@PennHousing KMP mobile app (apps/mobile) after any major UI change — a new screen, a new user-facing interactive gesture/control, a changed multi-step flow, or removal of user-facing functionality. Covers Android (Robolectric + Compose UI testing in the fast JVM unit-test source set, no emulator), iOS (XCUITest against a real kept target, run headless via xcodebuild test against the iPhone 17 Pro simulator), and the Maestro cross-platform E2E suite. Also detects and flags orphaned tests when the UI they cover is removed or changed — this is the mechanism that keeps the suite from rotting. Invoke this proactively right after implementing a major UI change, not only when explicitly asked to "add tests" or "write UI tests." See AGENTS.md for the exact major/minor UI change boundary.
---

# UI Testing (apps/mobile)

This skill encodes a specific, already-decided testing architecture for this repo — it is not a
generic "how to test mobile apps" skill. Follow the steps below in order; do not skip ISOLATE,
VERIFY, or MERGE, and do not substitute a different testing approach (e.g. reaching for
connectedAndroidTest or an interactive Simulator session) without an explicit justification,
documented inline, for why the default couldn't be used.

**Isolation is automatic — never ask.** This skill always runs its WRITE/VERIFY work in a scratch
git worktree (Step 0) and merges back at the end (Step 4a). Do not prompt the user to choose between
worktree / same-session / cloud execution, and do not use the interactive `EnterWorktree` tool for
this (it's for user-directed worktree sessions, not this skill's internal scratch space) — just run
the plain `git` commands below. This exists specifically so a concurrent session editing the same
checkout is never affected: the user's working directory and index are never touched except by the
final, additive merge in Step 4a.

## Step 0 — ISOLATE

Do this before IDENTIFY, every invocation, unconditionally:

```bash
SLUG=$(date +%s)  # or a short feature-derived slug if one is obvious
ORIG_BRANCH=$(git branch --show-current)
WT_PATH=".claude/worktrees/ui-testing-$SLUG"

# Snapshot any uncommitted changes WITHOUT touching the working tree or index.
# git stash create is non-destructive: it builds the stash commit object and
# leaves the working directory exactly as it was. Do NOT use `git stash push`/`pop`
# here — those mutate the current session's working tree, which is the one thing
# a concurrent session must never see disturbed.
STASH_SHA=$(git stash create)

git worktree add "$WT_PATH" -b "ui-testing/$SLUG" HEAD

if [ -n "$STASH_SHA" ]; then
  git -C "$WT_PATH" stash apply "$STASH_SHA"
fi
```

Do all of Steps 1–3 (IDENTIFY, WRITE, VERIFY) with `cwd` set to `$WT_PATH`. This worktree has its
own working directory, index, and Gradle/Xcode build output — it cannot collide with whatever the
original session (or any other concurrent session) is doing in the main checkout, and there is
nothing to stash there because nothing was stashed to begin with.

**Why this shape, briefly:** shared business logic already has strong `kotlin.test` coverage on the
JVM host — that's not this skill's job. This skill covers the two things nothing currently tests:
Android Compose screens/gestures, and iOS SwiftUI screens/gestures. Both defaults run on a JVM/CI-friendly
runner with no emulator or interactive simulator session, because a test suite that needs a human
sitting at a screen to run doesn't get run.

## Step 1 — IDENTIFY

Look at the diff (or the screen/branch you were pointed at) for:

- New or changed Composables (`androidApp/src/main/java/.../ui/`) or SwiftUI views (`iosApp/iosApp/`)
  that have user interaction — taps, drags, holds, text entry, navigation.
- New or changed public surface on a `:shared` ViewModel (`shared/src/commonMain/.../viewmodel/`)
  that a screen test would need to drive or observe (new `StateFlow` fields, new public functions).
- New or changed `testTag` (Compose) / `accessibilityIdentifier` (SwiftUI) values — these are the
  selector contract every test in this repo must use; a diff that adds UI without adding one of
  these is itself worth flagging back to the user before writing a test around a stand-in selector.

**Then, just as importantly, check the other direction.** Grep the existing test surfaces —
`androidApp/src/test/`, `iosApp/iosAppUITests/` (once it exists), and `apps/mobile/maestro/*.yaml` —
for `testTag`/`accessibilityIdentifier` string literals that:

- no longer appear anywhere in current source (the view was removed or renamed), or
- point at a control whose behavior changed enough that the old test's assertions no longer describe
  what actually happens (e.g. a gesture that used to be a single tap and is now hold-then-drag).

Flag every hit as an orphaned test candidate with the specific test file + line and the specific
source change that orphaned it. This check runs every time this skill runs, not only when someone
remembers to ask — it is the whole point of running this skill on every major UI change instead of
writing tests once and letting them drift.

## Step 2 — WRITE

### Android — default: Robolectric in `androidApp/src/test/`

Read `references/android-robolectric.md` before the first test in this source set — it does not
exist yet in this repo (`androidApp/src/test/` is empty, no Robolectric dependency), so the first
invocation of this skill needs to add the dependency and `testOptions` block. Later invocations skip
that and just add test files.

Only fall back to `androidApp/src/androidTest/` (real emulator/instrumented test) when Robolectric
genuinely cannot exercise the behavior — e.g. something that depends on a real GPU surface or an
OS-level API Robolectric shadows incorrectly. When you do this, put a one-line comment at the top of
the test explaining specifically what Robolectric couldn't do. This is the exception path, not a
convenience path — don't reach for it because a Robolectric test is fiddly to get passing.

### iOS — XCUITest against a real, kept target

Read `references/ios-xcuitest.md` before the first test — no XCUITest target exists yet in
`apps/mobile/iosApp/iosApp.xcodeproj`. It must be added to `apps/mobile/iosApp/project.yml` (the
XcodeGen source of truth for this project) and regenerated with `xcodegen generate`, so it is a real
checked-in target from here on, not scratch work that gets deleted after one bug. A target was built
this way once before and fully deleted — this time it stays.

Tests run via `xcodebuild test`, scripted, against the iPhone 17 Pro simulator. Never drive this
target interactively through the iOS Simulator control tools — those are for the user to _see_ the
app, not for verifying tests. A test suite that only "worked" during an interactive click-through
session hasn't actually been verified.

### Both platforms

- Assert exclusively through the existing `testTag` / `accessibilityIdentifier` contract. Never
  assert on coordinates, colors, or text content as a stand-in for a missing identifier — if a
  control needs one and doesn't have it, that's a small source change to make (and note in your
  report), not a reason to write a fragile test around it.
- For any custom or non-standard gesture — drag, hold-then-drag, multi-touch, anything beyond a
  plain tap — the test must actually perform that gesture (`performTouchInput` on Compose,
  `XCUIElement` press-and-drag APIs on iOS), not just assert the control is present. A test that only
  checks a drag handle exists doesn't tell you the drag works.

## Step 3 — VERIFY

Run the new/changed tests and the full affected suite before doing anything else, using the test
runners themselves:

- Android: `./gradlew :androidApp:testDebugUnitTest` (add `--tests` to scope while iterating).
- iOS: `xcodebuild test -project apps/mobile/iosApp/iosApp.xcodeproj -scheme iosApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro'` — see `references/ios-xcuitest.md` for the exact invocation once the test target/scheme exists.
- Maestro: `maestro test apps/mobile/maestro/<flow>.yaml` (see `references/maestro-audit.md` for
  running the whole suite against a fresh demo build).

Never verify by opening the iOS Simulator or an Android emulator and clicking through the flow
yourself — that's the expensive, non-repeatable pattern this skill exists to replace. If a test is
red, fix the test or the code, then re-run; never report the task done with a red test, and never
silently mark a test `@Ignore`/`XCTSkip` to make a run go green.

## Step 4 — COMMIT

Still inside `$WT_PATH`. One commit per distinct feature/change-set, conventional-commit subject
(`type(scope): summary`), per this repo's existing commit convention (AGENTS.md). If step 1 found an
orphaned test that needed updating or deleting because the UI it covered changed, that update ships
in the _same_ commit as the UI change that orphaned it — never a separate later "fix tests" commit.
That's what actually prevents the pile of stale tests from forming in the first place.

## Step 4a — MERGE (automatic, no prompt)

Bring the worktree's commit(s) back onto `$ORIG_BRANCH` and tear down the scratch worktree. Do this
unconditionally, in the original session's working directory — never leave the branch sitting
unmerged in the worktree waiting for the user to deal with it.

```bash
cd "$(git rev-parse --show-toplevel)"   # back to the original checkout, NOT $WT_PATH
git merge --no-ff "ui-testing/$SLUG" -m "test(mobile): merge UI test coverage from ui-testing/$SLUG"
```

This is safe against the original session's uncommitted changes: the merge only ever touches paths
this skill itself created or edited (new/updated test files, and — rarely — a `testTag`/
`accessibilityIdentifier` fix in a source file per Step 2's exception path). It never touches the
paths a concurrent feature change is actively editing, because those are different files by
construction (this skill doesn't rewrite feature logic).

**If the merge reports a conflict:**

1. `git status` to see which paths conflict.
2. If every conflicting path is a test file or a test-support file (i.e. under `androidApp/src/test/`,
   `iosApp/iosAppUITests/`, `apps/mobile/maestro/`, or the Robolectric/XCUITest scaffolding) — resolve
   it yourself: this means the original branch grew its own test changes since the worktree branched.
   Reconcile by keeping both sets of assertions where they're additive, and re-run VERIFY (Step 3)
   against the merged result before finishing. Never resolve a conflict by silently dropping one
   side's assertions.
3. If a conflicting path is a non-test source file, STOP and surface it to the user with the specific
   file and the two versions — do not guess at how to reconcile feature-code conflicts. This should be
   rare to never; if it happens, `git merge --abort`, leave `ui-testing/$SLUG` in place, and explain
   what happened instead of forcing a resolution.
4. After a clean merge (with or without step 2's manual reconciliation), remove the scratch worktree
   and its branch:

```bash
git worktree remove "$WT_PATH"
git branch -d "ui-testing/$SLUG"
```

If `git stash create` produced a `$STASH_SHA` earlier, it was only ever applied inside `$WT_PATH` —
the original working directory's uncommitted changes were never touched and need no restoring.

## Reference files

- `references/android-robolectric.md` — first-time Robolectric setup, ongoing conventions, gesture examples.
- `references/ios-xcuitest.md` — adding the XCUITest target to project.yml, xcodebuild invocation, gesture examples.
- `references/maestro-audit.md` — running the existing 15 flows headlessly and fixing breakage.
