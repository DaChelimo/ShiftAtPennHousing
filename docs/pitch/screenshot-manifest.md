# Screenshot manifest — Final Slides Outline

Captured 2026-07-27 for `docs/pitch/Final Slides Outline.md`.
Files live in `docs/pitch/screenshots/`.

- **Mobile** = iOS only, iPhone 17 Pro simulator, demo build (`SHIFT_DATA_SOURCE = demo`),
  light appearance. Native resolution, 1206x2622.
- **Web** = Chromium at 1600x1000, `deviceScaleFactor: 2`, so every PNG is 3200x2000.
  Signed in as `admin@upenn.edu`, house switched to Harnwell, week of **Aug 24 2026**
  (the summer weeks read "Closed" because the operating calendar only covers
  Aug 23 to Dec 20).

---

## Ready to drop in

| Slide  | File                                          | What it shows                                                                                                       |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **10** | `slide-10a-ios-my-shifts.png`                 | Worker's week: swap pending, swap request, picked-up shift, week navigator.                                         |
| **10** | `slide-10b-ios-house-week-grid.png`           | House week grid, every block in its worker's colour, desk phone number in the header.                               |
| **10** | `slide-10c-ios-contact-card-call.png`         | Shift details for Priya N.: home house, phone, email, **Call**, Email, Call the desk.                               |
| **11** | `slide-11a-ios-home-screen-widget.png`        | Home-screen widget beside the app icon. Currently showing the pending float.                                        |
| **12** | `slide-12a-ios-open-shifts-feed.png`          | Open Shifts, My House / Others tabs, two Claim buttons, one locked "Unpickable" seat.                               |
| **12** | `slide-12b-ios-incoming-swap.png`             | Two swap cards: one awaiting the other person, one "Needs your response" with Accept / Decline.                     |
| **12** | `slide-12c-ios-break-picker.png`              | Winter Break picker calendar, first-come first-served, 2h of 40h meter.                                             |
| **12** | `slide-12c-alt-ios-break-picker-claiming.png` | Same screen mid-claim, with the "Claimed 12:30 to 13:00 / Cancel / Claim" bar. Use if you want the gesture visible. |
| **13** | `slide-13a-ios-float-card-home.png`           | The float card that does not go away: "You're needed at DuBois", countdown, Accept / Decline.                       |
| **13** | `slide-13b-ios-widget-pending-float.png`      | Widget reading "FLOAT, Tonight 6:00 PM, DuBois Desk, Tap to acknowledge". Same file as 11a.                         |
| **14** | `slide-14a-web-schedule-builder-ai-panel.png` | Builder with the AI schedule generator panel, Expand and Publish. See the gap note below.                           |
| **15** | `slide-15a-web-hours-report.png`              | Hours report: 204 total, At home / Floated out / Cross-house pickup, then per worker.                               |
| **16** | `slide-16a-web-live-calendar.png`             | Live Harnwell week, real names, per-worker colours, open shifts hatched, full legend.                               |
| **19** | `slide-19a-ios-ask-snoopy.png`                | Ask Snoopy on the phone with four real desk questions.                                                              |
| **19** | `slide-19b-web-ask-snoopy.png`                | Ask Snoopy on the web, grouped by Access & Keys and Card & ID Issues.                                               |

## Notification mockups (slide 11 and slide 13)

Six lock-screen renders, 1206x2622, matching the iPhone 17 Pro. Composited: real app icon
pulled from the built `.app`, real simulator lock-screen wallpaper, iOS notification styling.
**These are mockups, not captures.** They could not be captured live because the pre-shift
reminder does not exist (see below) and the demo build never obtains notification permission,
so a simulator push is dropped.

All six share one clock, 10:00 on Tue 28 Jul, so they tell a single consistent story: the
shift starts at 11:00, and the float is today 12:00 to 14:00, which is the same float the
in-app card in `slide-13a-ios-float-card-home.png` shows.

### Shift reminder, one hour out (slide 11)

| File                                     | Title                            | Body                                                      |
| ---------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| `mockup-shift-reminder-a-minimal.png`    | Shift in 1 hour                  | Harnwell Desk, 11:00 AM to 3:00 PM.                       |
| `mockup-shift-reminder-b-explicit.png`   | Your shift starts at 11:00 AM    | Harnwell Desk, 11:00 AM to 3:00 PM. Tap to see your week. |
| `mockup-shift-reminder-c-wrong-desk.png` | Heads up: you're at DuBois today | Not Harnwell. Your shift starts at 11:00 AM.              |

Variant C is the one that earns its place in the deck. It answers the failure named on slide
6, "autopilot took them to their home desk", which none of the other copy addresses.

### Float assignment (slide 13)

| File                              | Title                              | Body                                               |
| --------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `mockup-float-a-shipped-copy.png` | Float assignment                   | You've been floated to DuBois. Tap to acknowledge. |
| `mockup-float-b-urgent.png`       | You're needed at DuBois today      | 12:00 PM to 2:00 PM. Tap to accept or decline.     |
| `mockup-float-c-ack-reminder.png` | Still waiting on your float answer | DuBois, today at 12:00 PM. Respond by 11:50 AM.    |

Variant A is the **copy the system ships today**, verbatim from
`Notifications.kt` (`withPendingFloatEntry`). B and C are proposals. C models the existing
`ack_reminder` escalation, so it pairs with the slide 13 line about reminders getting louder
as the shift approaches.

### Two things to know before you present these

1. **The pre-shift reminder is not built.** "Shift reminders / Always on (before each shift)"
   exists only as a settings row label in `Settings.kt`. There is no `shift_reminder` value in
   the `notification_type` enum, no cron that emits one, and no local-notification scheduling
   on either client. Slide 11 currently claims "a notification reminder before every shift".
   Either build it before the pilot or soften that line.
2. **No push renders a title or body today.** `dispatch-push` sends a **data-only** FCM
   message carrying `notification_id`, `type`, and `payload`. The visible text is composed
   client-side, so the copy above is what the app would show once a display path exists.

## Spares

| File                         | Where it might help                             |
| ---------------------------- | ----------------------------------------------- |
| `extra-web-action-inbox.png` | Slide 16, the manager's coverage view.          |
| `extra-web-people.png`       | Slide 22 or the "who maintains this" objection. |

---

## Gaps, and what each one needs

1. **Slide 14, the populated builder and worker picker.** The builder renders, but the
   grid is empty and **Generate with AI** is disabled: "The preference deadline is still
   open. Generate after it closes." So there is no AI draft and no worker picker to open.
   To get it: close the preference deadline for that period, run a generate, then click a
   block. `slide-16a-web-live-calendar.png` is the strongest populated-schedule image you
   currently have, and it carries the same "one live screen" point.

2. **Slide 11, the lock-screen notification.** The widget half is done. The notification
   half is not: the demo build never asks for notification permission, so a simulator push
   is dropped silently. To get it: run the app once, accept the OS notification prompt,
   then push again.

3. **Slide 19, Snoopy mid-answer.** Both Snoopy shots are the question screen, not an
   answer. The local knowledge base has **zero documents**, so any question returns
   nothing, and the demo mobile build has no backend at all. To get a real answer you need
   KB documents ingested locally, then ask on the web build.

4. **Slide 15, a float in the hours breakdown.** The report is populated but "Floated out"
   is 0 for that week, so the "how long, which house, what date" story is not visible in
   the image. Any week containing a real float would show it.

5. **Slide 22, the Excel exit.** Not captured. Matches the note at the top of your outline:
   the builder exports HTML and print/PDF today, there is no .csv or .xlsx download, so
   there is no "download the Excel sheet" screen to photograph yet.

---

## Notes on the environment

- Local Postgres had lost `SELECT/INSERT/UPDATE/DELETE` for both `authenticated` and
  `service_role` on every public table, which made web sign-in fail with
  `permission denied for table users`. Restored those two roles; `anon` was left stripped.
- The local DB had almost no schedule data (6 blocks). Loaded it non-destructively with
  `pnpm seed:seasons` then `pnpm seed:harnwell`. No `db reset` was run.
- `apps/mobile/iosApp/Configuration/Config.xcconfig` was flipped to `demo` to build the
  screenshot app and has been set back to `live`.
