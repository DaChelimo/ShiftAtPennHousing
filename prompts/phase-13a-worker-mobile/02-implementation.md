# Phase 13a — Worker Mobile: Implementation

## Session Metadata

|                   |                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| **Model**         | Claude Opus 4.7 (`claude-opus-4-7`)                                                                  |
| **Interface**     | Claude Code CLI                                                                                      |
| **Thinking mode** | Standard                                                                                             |
| **TDD role**      | Implementer                                                                                          |
| **Note**          | Claude Code (not Codex) — Compose Multiplatform requires KMP expertise better suited to Claude Code. |

---

## Prompt

You are implementing Phase 13a: Worker Mobile App (Compose Multiplatform — Android + iOS).

Branch: `phase-13a-worker-mobile`. Tests committed — do NOT modify them.

Sources of truth:

- BEHAVIORAL_SPECIFICATION.md §5.6, §5.2, §5.3, §7
- AGENTS.md
- `tests/PHASE_13a/TEST_PLAN.md`

Stack: Compose Multiplatform targeting Android + iOS. Supabase-kt for DB client.

---

### Deliverables

**1. Supabase-kt client setup in `commonMain`:**

```kotlin
// commonMain: shared Supabase initialization
val supabase = createSupabaseClient(
    supabaseUrl = BuildConfig.SUPABASE_URL,
    supabaseKey = BuildConfig.SUPABASE_ANON_KEY
) {
    install(Auth)
    install(Realtime)
    install(Postgrest)
}
```

**2. Screen: ShiftsScreen (3-tab layout in Compose)**

- Tab 1: My Shifts — LazyColumn with 3 sections (picked-up, dropped-open, scheduled)
- Tab 2: Open Shifts (home house) — weekly feed + permanent openings
- Tab 3: Open Shifts (other houses) — grouped, empty state during winter break

**3. ViewModel: ShiftsViewModel (commonMain)**

- Fetches data via Supabase-kt
- Realtime subscription on shift_block_assignments for the authenticated user
- Exposes UI state: `ShiftsUiState` with the three tab structures

**4. Screen: FloatAcknowledgmentScreen**

- Modal triggered by new float notification
- Shows float details, ack deadline countdown
- Ack / decline buttons; disabled after deadline

**5. expect/actual for platform-specific behavior:**

```kotlin
// commonMain
expect fun registerPushToken(token: String, platform: String)
expect fun openMailto(url: String)

// androidMain: FCM token registration + Intent.ACTION_SENDTO
// iosMain: APNs token registration + UIApplication.shared.open
```

**6. Push notification registration:**

- Android: request FCM token on app start, POST to `/register-push-token`
- iOS: request APNs authorization, get APNs token, POST to `/register-push-token` with platform='ios'
- Firebase handles APNs forwarding — use FirebaseMessaging on both platforms

**7. In-app notification toast:**

- Subscribe to Supabase Realtime `notifications` table filtered by recipient_user_id
- On new row → show a top-of-screen toast with the notification content

---

### Platform-specific notes

**Android:** target API 26+ (uses modern notification channels). Add FCM dependency in `androidMain/build.gradle.kts`.

**iOS:** add APNs capability in the Xcode project entitlements. Add `UNUserNotificationCenter` requestAuthorization call in iosMain. The `iosApp/iosApp` Xcode target needs Firebase iOS SDK added via Swift Package Manager.

---

### Verification (manual — run on both Android emulator and iOS simulator)

- [ ] 3-tab Shifts screen renders correctly on both platforms
- [ ] Realtime subscription updates My Shifts when a float is assigned (no manual refresh)
- [ ] Ack modal appears when a float notification is received
- [ ] Push token registered on first launch (check push_tokens table in Supabase Studio)
- [ ] Maestro flows pass on both Android emulator and iOS simulator

---

### Commit

```
git commit -m "phase-13a impl: Compose Multiplatform worker app — 3-tab Shifts screen, float ack/decline, Realtime subscription, push token registration (Android FCM + iOS APNs via Firebase), expect/actual platform hooks"
```
