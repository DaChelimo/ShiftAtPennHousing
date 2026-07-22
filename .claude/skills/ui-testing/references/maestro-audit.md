# Maestro: cross-platform E2E audit

`apps/mobile/maestro/` holds 15 YAML flows (`01-view-my-shifts.yaml` through `13-house-grid.yaml`,
plus `config.yaml` and `README.md`), driven by `testTag`/`accessibilityIdentifier`. They were written
at the Phase 13a baseline and have not been confirmed against the app since several redesigns
(manage-shift sheet merge, My Shifts becoming the calendar, bottom-nav restructuring, etc.).

**Known gap worth checking first:** `config.yaml`'s `flows:` glob is `"0*.yaml"`, and
`executionOrder.flowsOrder` only lists `01` through `07`. Flows `08` through `13` are 2-digit and
don't match a `0*` glob — confirm whether `maestro test apps/mobile/maestro/` (pointed at the
directory) actually picks up `08`-`13`, or only the numbered subset in `flowsOrder` does. If the
directory-level glob is what's silently only running 7 of 15 flows, that's a config fix, not a
per-flow content fix — do it separately and call it out explicitly rather than assuming a "run all
15" command is currently running all 15.

## Running the audit

Against a fresh demo build (no backend — DemoData) on both platforms:

```bash
# Android: install a fresh demo debug build, then run every numbered flow explicitly
# (don't rely solely on the directory glob given the gap above)
./gradlew :androidApp:installDebug
for f in apps/mobile/maestro/[0-9][0-9]-*.yaml; do
  maestro test "$f"
done
```

```bash
# iOS: build + install the demo configuration on the booted iPhone 17 Pro simulator,
# then run the same loop against it. See apps/mobile/iosApp/README.md for the demo
# build invocation (no -PSUPABASE_URL, so it boots into DemoData / login-bypass).
for f in apps/mobile/maestro/[0-9][0-9]-*.yaml; do
  maestro test "$f"
done
```

Read each flow's CLI output (pass/fail per step) — that IS the verification; don't additionally
screenshot-drive the simulator/emulator to "double check" a flow maestro already reported on.

## Fixing what's broken

For each failing flow:

1. Find the failing step's `testTag`/`accessibilityIdentifier` in the YAML.
2. Grep current source for that identifier. Three outcomes:
   - **Still exists, same meaning** — the flow's failure is a timing/selector-order issue (new
     screen inserted before it, a renamed intermediate step) — fix the flow's step sequence.
   - **Renamed** — a redesign changed the identifier string. Update the flow to the new string.
   - **Gone** — the control was merged into something else (e.g. the old separate drop/swap sheets
     merged into one "Manage shift" sheet) or removed outright. Rewrite the flow's steps to match
     current behavior, or delete the flow if the journey it tested no longer exists as a distinct
     user flow.
3. Re-run just that flow (`maestro test apps/mobile/maestro/<flow>.yaml`) until green before moving
   to the next.

Commit fixes per-flow (or grouped by the single redesign that broke them), separate from Phase 1
skill-scaffolding commits and separate from any new-test-writing commits — per AGENTS.md's one
commit per distinct change-set convention.
