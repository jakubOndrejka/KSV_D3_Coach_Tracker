# KSV D3 Coach Reliability & Culture Tracker

Generated: 2026-09-25

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


## v1.0.1 transport fix

This package includes a fix for Apps Script HTML Service's nested iframe behavior. The original v1.0.0 bridge could successfully process a login on the backend but never deliver the response back to GitHub Pages, causing a 30-second **Backend request timed out** message. Version 1.0.1 sends the bridge reply to the top page and validates it with a per-request random bridge key.

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
