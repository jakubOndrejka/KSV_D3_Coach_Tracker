# Data model

Generated: 2026-09-25

The Google Sheet is intentionally normalized enough to preserve history while remaining human-readable.

## Players

Roster synced from Holdsport. `position`, `include_in_tracker` and `active` are manual fields and are preserved across syncs.

## Events

Holdsport activities plus manually created meetings/events. `manual_type` overrides automatic Practice / Match / Meeting classification and is preserved across syncs.

## Participation

One row per player per event. It combines:

- raw Holdsport RSVP/status;
- normalized status (`attending`, `declined`, `undecided`, `unknown`);
- actual coach-recorded attendance;
- lateness in minutes;
- ready-at-start flag;
- broad context category;
- coach-contact flag;
- expected answer date;
- short factual note.

## RsvpHistory

Append-only snapshots when the observed Holdsport status or Holdsport `updated_at` value changes. This lets the app later distinguish response timing from the final status.

## Observations

Selected observable reliability/culture events. Negative observations start `open`; positive/repair observations can be stored as already resolved.

## Followups

Coach conversation / agreed action records linked to a player and optionally an observation.

## Duties

Assignments imported from Holdsport activity tasks when available, plus manual completion state (`assigned`, `done`, `covered`, `missed`, `excused`).

## SyncLog

Basic sync diagnostics.

## Why there is no player score

Attendance, communication, duties and culture behaviours are different constructs. The UI shows separate exception counts and timelines rather than collapsing them into one number.


### `DutyTypes`
One row per Holdsport task definition on an event. Stores the task name, Holdsport task ID, `max_participants`, whether sign-up is enabled, and the current assigned count. This is separate from `Duties`, which contains only actual player assignments. A two-person secretary task therefore creates one duty definition plus zero, one, or two player assignments; the other roster members are not treated as missing the duty.


## v1.0.5 additions

`Participation.holdsport_status_code` preserves Holdsport's numeric/string status code alongside the human-readable status so modern RSVP distinctions can be diagnosed without guessing. `RsvpHistory.status_code` preserves the same value over time.

The frontend also keeps a short-lived browser-side pending attendance queue. This is not a second database: it exists only to make session taps immediate and to retry unsaved changes if Apps Script/Google Sheets is slow or the connection drops.

## v1.0.6 interpretation

Attendance comparison is derived in the frontend from `Participation.actual_attendance` and `Events.auto_type/manual_type`; no new Sheet is required. Position remains `Players.position` and is coach-entered.

For KSV match activities with Holdsport `registration_type=2`, the backend interprets explicit `activities_users` status code `1` as selected and status code `5` as available/not selected. `no_rsvp` remains undecided.
