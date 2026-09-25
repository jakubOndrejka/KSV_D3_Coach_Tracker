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
| `SEASON_START` | `2026-08-01` | First date included in the dashboard |
| `SYNC_LOOKBACK_DAYS` | `21` | How far back each API sync re-checks |
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

If you previously uploaded **v1.0.0**, replace `api.js`, `sw.js`, and `backend/Code.gs` with the v1.0.1 files, then redeploy Apps Script as a **new version**. v1.0.0 had an iframe bridge bug that could produce this timeout even when the password and deployment were correct.

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
