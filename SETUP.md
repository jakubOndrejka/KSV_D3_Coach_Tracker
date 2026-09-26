# KSV D3 Coach Tracker — Setup Walkthrough

Generated: 2026-09-25

You do **not** need Node, npm, a database server, or paid hosting.

You need:

- one Google Sheet;
- one Google Apps Script project bound to that Sheet;
- a GitHub repository with GitHub Pages;
- your Holdsport login credentials.

Estimated setup: **15–25 minutes**.

---

## Part A — Create the private data backend

### 1. Create the Google Sheet

Create a new Google Sheet, for example:

`KSV D3 Coach Tracker Data`

Do not manually create tabs. The script will do it.

### 2. Open Apps Script

In the Sheet:

**Extensions → Apps Script**

Delete the default `myFunction()` code.

Open this downloaded project's file:

`backend/Code.gs`

Copy the whole file into the Apps Script editor and save.

### 3. Run initialization once

At the top of Apps Script choose the function:

`initializeProject`

Then click **Run**.

Google will ask for authorization because the script needs to access the bound Sheet, create an hourly trigger, and call the Holdsport API.

After the run, your Sheet should contain these tabs:

- Players
- Events
- Participation
- RsvpHistory
- Observations
- Followups
- Duties
- SyncLog

The initialization also installs an hourly `scheduledSync` trigger. It does nothing until Holdsport is configured.

### 4. Add secrets — do NOT put them in the code

In Apps Script:

**Project Settings → Script Properties → Add script property**

Add these three properties:

| Property | Value |
|---|---|
| `APP_PASSWORD` | A strong password only you know |
| `HOLDSPORT_USERNAME` | Your Holdsport/SportMember login username |
| `HOLDSPORT_PASSWORD` | Your Holdsport password |

Recommended: make `APP_PASSWORD` different from your Holdsport password.

Optional properties:

| Property | Default | Purpose |
|---|---:|---|
| `SEASON_START` | `2026-09-07` | First date included in the dashboard |
| `MATCH_ROSTER_LIMIT` | `14` | Maximum playing roster for matches; defaults to 14 if omitted |
| `SYNC_LOOKAHEAD_DAYS` | `60` | How far ahead activities are pulled |

Do **not** add `HOLDSPORT_TEAM_ID` yet; the web app can discover it for you.

### 5. Deploy the Apps Script Web App

Apps Script:

**Deploy → New deployment → Select type → Web app**

Set:

- **Execute as:** Me
- **Who has access:** Anyone

Then click **Deploy**.

Why `Anyone`? The GitHub Pages site must be able to submit requests without requiring a Google login. The data endpoint is still protected by the separate `APP_PASSWORD` session layer in `Code.gs`.

Copy the Web App URL. It should look roughly like:

`https://script.google.com/macros/s/.../exec`

Keep this URL; you will paste it into the frontend once.

### 6. Quick backend test

Open the Web App URL directly in a browser.

You should see:

`KSV D3 Tracker backend is running`

If you see a Google permission/login screen instead, the deployment access is not set to **Anyone**.

---

## Part B — Publish the frontend on GitHub Pages

### 1. Create a GitHub repository

Example name:

`ksv-d3-coach-tracker`

The repository can contain the backend source code because it contains **no secrets**. Never add your Holdsport password or app password to GitHub.

### 2. Upload the project

Unzip `KSV_D3_Coach_Tracker.zip`.

Upload **all files and folders inside it** to the root of your repository, including:

- `index.html`
- `app.js`
- `api.js`
- `styles.css`
- `manifest.webmanifest`
- `sw.js`
- `assets/`
- `backend/`

Commit to `main`.

There is no build step.

### 3. Enable GitHub Pages

Repository:

**Settings → Pages**

Under **Build and deployment**:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ (root)`

Save.

GitHub will show your Pages address after deployment, typically:

`https://YOURNAME.github.io/ksv-d3-coach-tracker/`

---

## Part C — First login and Holdsport sync

### 1. Open the GitHub Pages URL

The first screen asks for the Apps Script Web App URL.

Paste the `/exec` URL from Part A and save.

The URL is stored only in that browser's local storage. It is not written into the repository.

### 2. Sign in

Enter the `APP_PASSWORD` you created in Script Properties.

A signed session token is stored in `sessionStorage`, so closing the browser/tab ends the local session. The token also expires server-side.

### 3. Select the Holdsport team

Go to:

**Settings → Discover Holdsport teams**

Choose the KSV D3 team.

The backend stores only the numeric team ID, then starts the first sync.

### 4. Verify the first sync

Check:

- player names;
- upcoming trainings/matches;
- Holdsport YES / NO / UNDECIDED state for 2–3 activities;
- one activity with a duty if you have one.

This validation matters because Holdsport's public API documentation includes legacy examples and team configurations can expose activity status slightly differently.

If something does not match Holdsport, do not build coaching conclusions from it yet. Check the `SyncLog` tab and Apps Script **Executions**.

---

## Part D — Recommended first configuration

### Positions

Open the web app:

**Players → player → Edit**

Set short positions such as:

- `S`
- `OH`
- `MB`
- `OPP`
- `L`

### Event types

The backend classifies activity names using common Danish/English words such as `kamp`, `match`, `træning`, `training`, `møde`, `meeting`.

If an event is classified incorrectly:

**Session → Type**

Choose Practice / Match / Meeting / Other.

The manual override is preserved on future Holdsport syncs.

### Manual meetings

Use:

**Session → +**

or

**Settings → Add manual event**

This is useful for meetings not created in Holdsport.

---

## How to use it during a normal practice

1. Open **Session**.
2. Choose tonight's training.
3. Tap **Mark expected present + on time**.
4. Only change the exceptions:
   - `+5`
   - `+10`
   - `+15`
   - `No show`
   - `•••` for context/readiness/notes.
5. Add a culture/reliability observation only when something is actually worth preserving.

A normal practice with no exceptions should take only a few seconds of admin.

---

## How to record culture without turning it into a punishment score

Use observations for **observable behaviour**, for example:

- did not communicate an important availability change;
- did not help with setup/pack-up;
- phone use during practice;
- disengaged while others were working;
- did not join a match huddle / stay ready;
- blame or negative body language;
- disrespectful communication;
- missed assigned duty;
- good repair / took responsibility;
- covered a teammate's duty.

Avoid labels such as:

- `bad attitude`;
- `lazy`;
- `not committed`.

The app is built around **facts + context + repetition + repair**.

---

## Follow-up / Own → Repair → Reset

On a player's page, an open negative observation has:

**Add follow-up / resolve**

Record:

- conversation date;
- agreed action;
- whether it is resolved/repaired or remains open.

This makes a one-off mistake visibly different from a repeated issue after a conversation.

---

## Installing it on your phone

Because this is a PWA:

### iPhone / iPad

Open the GitHub Pages site in Safari → Share → **Add to Home Screen**.

### Android / Chrome

Open the site → browser menu → **Install app** / **Add to Home screen**.

The interface itself is cached for offline opening. For safety, writes are not queued offline in this first version; if you are offline, wait until connectivity returns before recording new data.

---

## Updating the app later

Replace files in GitHub and commit. The service worker uses network-first updates, so clients should pick up new files when online.

If you edit `backend/Code.gs`, remember that Apps Script Web Apps use a deployed version:

**Deploy → Manage deployments → Edit → New version → Deploy**

You can keep the same `/exec` URL.

---

## Troubleshooting

### "Backend request timed out"

If you previously uploaded **v1.0.0**, replace `api.js`, `sw.js`, and `backend/Code.gs` with the v1.0.4 files, then redeploy Apps Script as a **new version**. v1.0.0 had an iframe bridge bug that could produce this timeout even when the password and deployment were correct.

Most likely:

- the Web App URL is wrong;
- you pasted the `/dev` test URL instead of `/exec`;
- Web App access is not set to **Anyone**;
- the Apps Script deployment is still an old version.

### "Incorrect app password"

Check `APP_PASSWORD` in Apps Script → Project Settings → Script Properties.

### Holdsport returns 401

Check `HOLDSPORT_USERNAME` and `HOLDSPORT_PASSWORD`. The official Holdsport API uses HTTP Basic Authentication.

### Players load but statuses look wrong

Compare a real activity in Holdsport with the `Participation` and `RsvpHistory` tabs. The app intentionally keeps raw Holdsport statuses alongside normalized values so the mapping can be adjusted without losing the source data.

### I changed Apps Script code but nothing changed

Redeploy the Web App as a **new version** under the existing deployment.

---

## Security checklist

- Never commit Holdsport credentials.
- Use a strong `APP_PASSWORD`.
- Do not share the Google Sheet outside the coaching/admin group that needs it.
- Keep notes factual and minimal.
- Avoid detailed medical, family or other sensitive explanations when a broad context category is sufficient.
- If you stop using the app, delete or disable the Apps Script Web App deployment and the hourly trigger.


## v1.0.4 Holdsport behaviour

- The Holdsport sync starts at `SEASON_START`. For KSV D3 2026/27 use `2026-09-07`.
- Match RSVP states are kept separately when Holdsport reports them: `YES`, `SELECTED`, `AVAILABLE`, `NO`, `UNAVAILABLE`, `VACATION`, `INJURED`, `UNDECIDED`.
- `AVAILABLE` is treated as expected support for a match, but remains distinct from the selected playing roster.
- `INJURED` is also treated as expected support for KSV D3 matches unless the player is explicitly unavailable/away.
- Secretary/duty activities do not count the whole roster as an attendance opportunity.
- Holdsport activity tasks are imported with `max_participants`. For example, a secretary task with capacity 2 is shown as `0/2`, `1/2`, or `2/2`; only the people actually assigned to it can later be marked Done/Covered/Missed.


### Available / vacation status caveat

Holdsport's current UI supports both **Til rådighed / Available** and the vacation calendar. The documented REST API is less explicit about these newer distinctions. v1.0.4 recognizes them when the live activity payload exposes a textual status, and it also understands `registration_type` plus `joined_status`/`picked` for availability-selection activities.

If a real player who is visibly `Available` or on `Vacation` in Holdsport still appears as `UNKNOWN`, run `debugHoldsportSchema()` and compare the `activity_event_type_samples`, `activity_user_status_samples`, and `fetched_activity_user_status_samples` sections. Do not guess or manually relabel large numbers of players until that live payload has been checked.


## v1.0.5 update notes

If upgrading from v1.0.4, replace the frontend files and `backend/Code.gs`, then redeploy Apps Script as a **New version**. You do not need to recreate the Sheet or rerun `initializeProject()`. New diagnostic/status columns are appended automatically when the backend next reads/writes the affected sheets.

`MATCH_ROSTER_LIMIT` is optional because the backend defaults to `14`, but adding it explicitly in Script Properties makes the team rule easy to see/change later.

Session attendance now saves optimistically: a tap updates the screen immediately, then changes are batched to Google Sheets after a short delay. Pending changes are stored in the browser and retried after temporary network/backend failures.

## v1.0.7 update notes

Replace the frontend files and `backend/Code.gs`, redeploy the Apps Script web app as a **New version**, then sync Holdsport once. No Sheet recreation or `initializeProject()` rerun is required.

Positions are intentionally manual: Players → player → **Edit** → choose S / OH / MB / OPP / L. Holdsport sync preserves the saved position.

The Attendance tab compares actual marked attendance within each position. If older events have not been marked in the tracker, they appear as **unmarked** and are not treated as absences in the percentage.
