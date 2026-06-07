# Admin web reskin — PROGRESS

Resume tracker for the `design/web` reskin (worktree: `…/shift-web`). The locked
contract is [`DESIGN_TOKENS.md`](DESIGN_TOKENS.md); the visual source of truth is
`admin-web.html` (a ~1.7 MB **minified JS bundle** — not readable markup; use
`docs/design-brief.md §6` as the semantic spec). Reskin, don't rebuild: reuse the
foundation in `components/ui/` + `app/globals.css`; preserve behavior, data, RLS,
routes, and every test contract.

## Status: all admin + supporting screens reskinned ✅

| Screen (design ref)                     | Route                            | Commit    | Notes                                                             |
| --------------------------------------- | -------------------------------- | --------- | ----------------------------------------------------------------- |
| Foundation (tokens/shell/kit)           | `components/ui`, `globals.css`   | `ecf9916` | prior                                                             |
| Live calendar (§6.1)                    | `/calendar`                      | `7f07d10` | prior · read-only; override flagged                               |
| Schedule builder (§6.3)                 | `/schedule-builder`              | `4ef356a` | prior · visual-only; drag/testids preserved                       |
| Coverage + Action inbox (§6.4)          | `/coverage`, `/inbox`            | `4929a3d` | prior · read-only; write actions flagged                          |
| **Leave (§6.7)**                        | `/admin/leave`                   | `29643ec` | reskin · uses shared ComboBox; mailto preserved                   |
| **HMOD rotor (§6.8)**                   | `/admin/rotor`                   | `80ff60d` | reskin · .dtable grid + EmptyState                                |
| **Weekly hours cap (§6.9)**             | `/admin/cap` (+ `/hours-cap`)    | `614af46` | reskin · .seg 20/40, TextArea notes, audit readback               |
| **People / roster (§6.6) — NEW**        | `/admin/people`                  | `b5df5f2` | new · roster + hours-vs-cap meter; Hire/Fire flagged              |
| **Hours report (§6.10) — NEW**          | `/admin/hours`                   | `3cbabf6` | new · home/float/pickup decomposition + composition bars          |
| **Config + Health (§6.12)**             | `/admin/config`, `/admin/health` | `c028ec5` | reskin · config editor + tick read-out; integration cards flagged |
| **Login**                               | `/login`                         | `84c4624` | reskin · branded card on brand gradient                           |
| **Preferences oversight (§6.11) — NEW** | `/admin/preferences`             | `5b333fe` | new · submission + 5/3/1 reminder tracking; Set-deadline flagged  |

## Foundation additions this session (additive, backward-compatible)

- `Notification` — optional `testId` (root `data-testid`).
- `ComboBox` — optional `testId` (trigger) + `listTestId` (menu/listbox).
- `Field` — new `<TextArea>` component + `.textarea` CSS class (Carbon text area).
  Reused by Cap notes and the Config editor.

No new screen-specific CSS files were needed; People/Hours use existing primitives
(`.dtable`, `.statstrip`, `.meter`, `.seg`, `.kv-list`) + small inline styles.

## NEW screens — data-availability (read-only over EXISTING data; no backend invented)

- **People** (`lib/data/people.ts`): `houses` + `users` (home-house scoped) +
  `user_roles` via the service client (people-admin RLS is HM/BM-only, page gates
  on `isHouseAdmin`); weekly hours = counting-status `shift_block_assignments`
  (mirrors `worker_my_shifts` statuses) × 0.5h vs `effective_weekly_cap`.
- **Hours** (`lib/data/hours.ts`): same engine, **decomposed** by the canonical
  `worker_my_shifts` kind logic (scheduled→home, floated_in/pending_float_in→
  floated-out, claimed+is_cross_house_pickup→cross-house pickup). Gated SM/HM/BM.
- **Preferences oversight** (`lib/data/preferences.ts`): the active period =
  most-recent **unpublished** `scheduling_periods` row; submission status mirrors
  the builder's `submittedUserIds` (`preferences` ∪ non-opt-out `period_targets`;
  `opted_out`→"no hours"); reminder 5/3/1 status reads the real
  `preference_reminder_sends` table (authoritative "sent"), with overdue/upcoming
  for outstanding workers derived from the deadline + now. Roster = active SW/SM
  home-housed here (the population `send_preference_reminders` targets). Gated SM/HM/BM.

## Flagged (design shows it; NO backing RPC → surfaced disabled/flagged, never faked)

- **People**: Hire / Fire (no create-user / fire-worker RPC).
- **Preferences**: Set submission **deadline** — the `scheduling_periods.preference_deadline`
  column exists (shown live, read-only) but there is no set-deadline RPC (only a
  service-role RLS policy), so the date input + Set button are disabled + flagged.
- **Health**: per-integration cards (SMS / Allied / SSO / SIS) — only the
  orchestrator tick is recorded; surfaced as a flagged note.
- (prior) Live-calendar inline override; Coverage force-trigger / "Mark covered /
  Call Allied"; Inbox actions — all flagged in their earlier commits.

## Verification (all green, this session)

- `pnpm type-check`, `pnpm lint`, `pnpm build` (apps/web) — clean (19 routes,
  incl. `/admin/preferences`).
- Repo-root Vitest: **561/561** (`pnpm test`).
- Playwright: **15/15** — but **run `supabase db reset` first** (the publish e2e
  needs an unpublished seed; a prior in-session publish contaminated it once).
- Local seed has **no published schedule** (all blocks `vacant`), so People/Hours
  render 0h until a schedule is published; the populated path was verified by
  running the builder publish flow (alice → 1h) and screenshots (light + dark).

## What's next (not in this session's scope)

- **All §6 admin + supporting screens are now reskinned/built** — §6.11
  Preferences oversight (`5b333fe`) was the last one. The data check held: the
  deadline field (`scheduling_periods.preference_deadline`) exists but has no
  write RPC (flagged), and submission/reminder status is fully derivable from
  `preferences` + `period_targets` + `preference_reminder_sends`.
- SW phone views (§7.x) are the mobile app's surface — out of scope for the
  desktop admin reskin.
