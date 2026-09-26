# KSV D3 Coach Reliability & Culture Tracker

Generated: 2026-09-26

A mobile-first, no-build GitHub Pages app for tracking the **exceptions and patterns** that matter to the KSV D3 team culture: RSVP reliability, attendance, lateness, readiness, communication, duties, observable culture behaviours, follow-up and repair.

The app intentionally does **not** calculate a universal player score or automatically make selection/playing-time decisions.

## What is included

- Static GitHub Pages frontend: plain HTML/CSS/JavaScript, no npm/build step.
- PWA shell that can be installed on a phone and keeps the interface available offline.
- Google Apps Script backend.
- Google Sheet database created automatically by `initializeProject()`.
- Holdsport REST API sync for:
  - team roster;
  - activities;
  - activity-user RSVP/status data;
  - activity duties/tasks where available.
- Fast event mode:
  - one tap to mark expected players present + on time;
  - `+5`, `+10`, `+15`, no-show;
  - detailed context and readiness when needed.
- Player timelines and recent pattern indicators.
- Culture/reliability observations with factual notes.
- `Own → Repair → Reset` follow-up flow.
- Match RSVP flags around the one-week decision point.
- Coach-only app password; Holdsport credentials never enter the GitHub repository.



## v1.0.5 speed + session semantics

- Session attendance taps are now **optimistic**: the UI changes immediately instead of waiting for Google Sheets.
- Attendance edits are debounced and sent to Apps Script in **batches**, with a local retry queue if the network/backend is slow or temporarily unavailable.
- Removed **Mark whole roster**. The main button is now **Mark all expected present**.
- `NO`, `VACATION`, and `UNAVAILABLE` show as **Not expected** and need no attendance click; they can still be marked **Present anyway** if someone unexpectedly comes.
- Match support semantics remain: `AVAILABLE` and `INJURED` count as expected at the venue for matches, while staying separate from the playing roster.
- Adds a configurable match roster limit (`MATCH_ROSTER_LIMIT`, default `14`).
- Full-season Holdsport pagination no longer assumes the server honours the requested page size.
- Debug output now includes `status + status_code`, `no_rsvp`, pagination totals, and activity-task capacity/assignment shapes.

## v1.0.4 transport fix

This package includes a fix for Apps Script HTML Service's nested iframe behavior. The original v1.0.0 bridge could successfully process a login on the backend but never deliver the response back to GitHub Pages, causing a 30-second **Backend request timed out** message. Version 1.0.4 sends the bridge reply to the top page and validates it with a per-request random bridge key.

## Fast start

1. Read `SETUP.md`.
2. Create the Google Sheet + Apps Script backend.
3. Deploy Apps Script as a Web App.
4. Upload **everything in this folder** to the root of a GitHub repository.
5. Enable GitHub Pages from `main / (root)`.
6. Open the site, paste the Apps Script Web App URL, and sign in.
7. Settings → **Discover Holdsport teams** → choose KSV D3 → sync.

You can also choose **Preview with demo data** before the backend is configured.

## Files

- `index.html` — app shell.
- `styles.css` — KSV-inspired black/white/orange UI.
- `api.js` — secure browser ↔ Apps Script iframe/form bridge.
- `app.js` — dashboard, session mode, players, observations and settings.
- `sw.js` / `manifest.webmanifest` — PWA support.
- `backend/Code.gs` — Apps Script backend.
- `backend/appsscript.json` — optional manifest reference.
- `SETUP.md` — exact setup walkthrough.
- `DATA_MODEL.md` — what each sheet means.

## Important privacy note

The GitHub Pages **code** may be public, but the data is not embedded in it. Player data stays in your Google Sheet and is returned only after app-password authentication through the Apps Script backend.

Use a strong app password. Avoid detailed health or personal information in notes; broad categories such as `health`, `work/study`, `emergency`, or `excused/personal` are usually enough.

## Holdsport API caveat

The official Holdsport repository documents Basic Authentication and the endpoints used here, but parts of the example payloads are old. The sync code therefore stores raw statuses, normalizes conservatively, and preserves manual data. After first connection, check 2–3 real practices/matches against Holdsport before relying on automatic flags.


### v1.0.4
- Full-season sync begins on 7 September 2026 instead of a rolling lookback.
- Adds Holdsport `AVAILABLE`, `SELECTED`, `VACATION`, `UNAVAILABLE`, and `INJURED` handling; for KSV D3, `AVAILABLE` and `INJURED` are treated as match-support attendance rather than playing-roster selection.
- Adds Secretary duty as a distinct event type.
- Imports Holdsport task capacity (`max_participants`) so a two-person secretary duty is tracked as two required slots, not as an obligation for the whole roster.

## v1.0.7 attendance design

- Adds a dedicated **Attendance** tab grouped by volleyball position (S, OH, MB, OPP, L).
- Player overview now separates attendance by event type, e.g. `4/6 practice · 2/2 match`.
- Player detail adds an attendance graph with practice/match rates and an event-by-event visual strip.
- Attendance percentages use **actual attendance marks only**; older unmarked events are shown as missing data rather than silently counted as absences.
- Volleyball positions are edited manually because the live KSV Holdsport member payload does not expose them.
- For KSV matches using `registration_type=2`, live REST semantics are mapped as: status code `1` = selected roster, status code `5` in `activities_users` = available/not selected, while `no_rsvp` remains undecided.
- If the legacy REST response cannot distinguish a Holdsport vacation from another non-response state, the coach can set participation **Context = vacation**; bulk-present then skips that player and the row is treated as not expected.


## v1.0.7 attendance + position colours

- Player positions remain manual because Holdsport's public REST member response does not expose KSV's member-colour assignment. The UI now mirrors KSV's Holdsport colours: Outside `#00ac01`, Middle `#ffff20`, Libero `#1921c6`, Setter `#e8bf20`, Diagonal `#20e8df`.
- Attendance percentages now use **all past practices/matches in the selected window** as the denominator.
- Attendance bars are stacked into present, late, unregistered/unavailable, vacation, excused/injured, no-show/unexcused, and unmarked.
- Added 15-day filters to player and position attendance views.
- Added `debugHoldsportVacationCandidates()` to investigate Holdsport's UI-only **On vacation** category without guessing or changing data.
