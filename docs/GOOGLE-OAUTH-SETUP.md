# Connecting Google Calendar

Overlap can read a member's free/busy directly from Google instead of asking
them to paste a secret iCal URL. This is optional: with `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` unset, the button never appears and nothing changes.

## What Overlap asks Google for

Two scopes, asked for at two different moments.

**Connecting a calendar asks for one scope, and only one:**

```
https://www.googleapis.com/auth/calendar.freebusy
```

The `freeBusy` endpoint returns `{ start, end }` pairs. It does not return
titles, attendees, or locations — there is nothing in the response to leak,
log, or store. Overlap's promise that it records *that* you are busy and never
*what* is enforced by Google's API surface, not by our own discipline.

**"Add to Google Calendar" asks for a second one, the first time it is used:**

```
https://www.googleapis.com/auth/calendar.events.owned
```

This is incremental authorisation. Nobody sees it when they connect; it is
requested only when a connected member clicks **Add to Google Calendar** on an
agreed time, and the event is written as soon as they approve, so the click
that asked is the only click it takes. After that, adding (including when they
pick a time themselves) is instant.

`calendar.events.owned` rather than `calendar.events`: it covers only calendars
the person owns, never calendars shared with them. Overlap uses it to insert
one event on the primary calendar, with no attendees, under an id derived from
the circle and the time, so repeat clicks never create duplicates. It never
lists or reads events.

Members without Google connected are unaffected: they get the `.ics` download
plus an "Open in Google Calendar" link that prefills Google's own event page
and needs no grant at all.

**This scope is almost certainly classed as sensitive** (every Calendar scope
that can see events is). Consequences, until the app passes Google's
verification review:

- The write-access consent screen shows Google's "unverified app" warning.
  Members click **Advanced → Go to Overlap** to continue. The connect flow is
  unaffected, because it still asks only for `calendar.freebusy`.
- Google caps an unverified app requesting sensitive scopes at 100 users
  granting them, over the app's lifetime.
- Some Workspace admins block unverified apps outright. Those members still
  have the `.ics` download and the prefilled Google link.

For a handful of co-founders none of this blocks anything. Before it is
opened wider, submit the app for verification; see the follow-up prompt at
the end of this file.

## Read this before you start

**Google revokes refresh tokens after 7 days while the app's publishing status
is "Testing" and its user type is "External".** Every connected calendar will
silently stop syncing a week later. There are three ways out:

| Option | Works for | Cost |
|---|---|---|
| **Internal** user type | Only accounts in your Google Workspace org | No verification, no 7-day limit. Co-founders outside the org cannot connect. |
| **In production** | Anyone | Sensitive scopes need Google's verification review first. |
| Stay in **Testing** | Up to 100 named test users | Free and instant, but everyone reconnects weekly. |

**For Overlap specifically, take the middle row.** The single scope is
non-sensitive (confirmed below), so publishing needs no review and is the only
option that does not quietly break in a week.

Testing mode is fine for trying it with two or three people this week. It is
not something to leave running.

**Confirmed, 2026-09-20: `calendar.freebusy` is classified NON-SENSITIVE.**
It appears under "Your non-sensitive scopes" with the sensitive list empty.

That is the good outcome, and it changes the recommendation above: because the
only scope requested is non-sensitive, **this app can be switched to "In
production" without Google's verification review** — which removes the 7-day
refresh-token revocation entirely. There is no reason to leave it in Testing
once you have confirmed the flow works.

That still holds with "Add to Google Calendar". Publishing is what matters for
the connect flow, and the write scope only adds the unverified-app warning on
its own, separate consent screen (see above).

---

## Browser agent prompt

Paste everything between the lines into a browser agent. Run it while signed
into the Google account that should own the project.

---

You are setting up a Google Cloud OAuth client for an app called **Overlap**, a
meeting-time scheduler. Work in the browser, signed in as the current user. Go
step by step and tell me what you see if a screen does not match what I
describe — Google has been redesigning this area ("APIs & Services" is becoming
"Google Auth Platform"), so treat my navigation hints as approximate and the
on-screen labels as authoritative.

**Never paste the client secret into any website, search box, document, or
chat. Report it only in your final message to me.**

1. Go to `https://console.cloud.google.com/`.

2. Create a new project named exactly `Overlap`. Use the project picker in the
   top bar. If a project named `Overlap` already exists, select it instead of
   creating a second one, and tell me you did.

3. Make sure the new project is the one selected in the top bar before
   continuing. This is the most common way this setup goes wrong — steps 4
   onward silently apply to whatever project is selected.

4. Enable the Calendar API: go to **APIs & Services → Library**, search for
   `Google Calendar API`, open it, and click **Enable**. Confirm it says
   "API enabled" or shows a "Manage" button before moving on.

5. Configure the consent screen: **APIs & Services → OAuth consent screen**
   (it may be called **Google Auth Platform → Branding**). Choose user type
   **External**. Fill in:
   - App name: `Overlap`
   - User support email: the signed-in account
   - Developer contact email: the signed-in account
   Leave logo, app domain, and links blank. Save and continue.

6. Add the scope. On the **Scopes** step (or **Google Auth Platform → Data
   Access**), click **Add or remove scopes**, and in the filter box paste:
   `https://www.googleapis.com/auth/calendar.freebusy`
   Tick it and click **Update**, then Save and continue.
   **Report back to me the exact sensitivity label Google shows next to that
   scope — "Non-sensitive", "Sensitive", or "Restricted".** It will be in a
   column or a badge on that screen. This determines whether publishing needs a
   review, so quote it exactly rather than paraphrasing.

7. Add test users. On the **Test users** step (or **Audience**), click
   **Add users** and add the signed-in account's email address. Tell me when
   this is done so I can give you any co-founder addresses to add — while the
   app is in Testing, only listed test users can connect at all.

8. Create the client: **APIs & Services → Credentials → Create credentials →
   OAuth client ID**. Application type: **Web application**. Name: `Overlap web`.

9. Under **Authorised redirect URIs**, add these three, exactly as written,
   with no trailing slash:
   ```
   https://overlap.runs-on.dev/api/google/callback
   https://overlap-advancelabs.vercel.app/api/google/callback
   http://localhost:3000/api/google/callback
   ```
   The first is the one that matters: it is the address people actually use.
   The redirect URI Overlap sends is derived from the origin of the request,
   so a visitor on `overlap.runs-on.dev` triggers a callback to that host, and
   Google refuses any host not listed here.
   These must match character for character or the OAuth flow fails with
   `redirect_uri_mismatch`. Do not add anything to "Authorised JavaScript
   origins" — it is not needed for a server-side flow.

10. Click **Create**. Google shows the **Client ID** and **Client secret**.

11. Finally, go to the **OAuth consent screen / Audience** page and tell me
    what the **Publishing status** currently says (it will be "Testing" unless
    you changed it). Do not click "Publish app" — I want to decide that myself
    after hearing the scope's sensitivity label.

**Report back, in your final message:**
- The Client ID
- The Client secret
- The sensitivity label from step 6
- The publishing status from step 11
- Anything that did not match these instructions, and what you did instead

---

## After the agent finishes

Put the two values into Vercel and locally:

```bash
# from the repo root
printf '%s' '<CLIENT_ID>'     | vercel env add GOOGLE_CLIENT_ID production
printf '%s' '<CLIENT_SECRET>' | vercel env add GOOGLE_CLIENT_SECRET production
# repeat for preview and development, then redeploy
vercel deploy --prod
```

Add the same two lines to `.env.local` for local development.

Then open a circle, click **Connect Google Calendar** beside your name, and
approve. Google will warn that the app is unverified — expected while the
publishing status is Testing. After approving, the circle page reloads with
`?calendar=connected`, and your busy time is pulled in on the next page load
rather than immediately, because the sync runs after the response is sent.

## If it fails

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` | The URI in the console does not exactly match the one the app sent. Check scheme, host, port, path, trailing slash. |
| `access_blocked` / "app not verified" | The signing-in account is not in the test-user list. |
| Connected, then stopped working a week later | The 7-day Testing-mode refresh-token revocation. See the table above. |
| `?calendar=no-refresh-token` | Google returned no refresh token. Overlap always sends `prompt=consent` so this should not happen; check the client is a **Web application** type. |


---

## Follow-up: add the real domain

The first setup run registered redirect URIs for `overlap-advancelabs.vercel.app`,
which was the address at the time. The app now lives at `overlap.runs-on.dev`,
and Google rejects any callback host that is not registered. Hand this to a
browser agent:

---

Go to `https://console.cloud.google.com/auth/clients` with the **Overlap**
project selected in the top bar. Open the OAuth client named **Overlap web**.

Under **Authorised redirect URIs**, add one more entry, exactly as written,
with no trailing slash:

```
https://overlap.runs-on.dev/api/google/callback
```

Leave the two existing URIs in place. Save.

Then go to `https://console.cloud.google.com/auth/audience`. The publishing
status will say **Testing**. Click **Publish app** and confirm.

This is safe to do without a verification review: the only scope this app
requests is `calendar.freebusy`, which Google classifies as non-sensitive.
Publishing is what stops Google revoking every connected calendar after seven
days.

Report back: the full list of redirect URIs on the client after saving, and
the publishing status after the change.

---


---

## Follow-up: declare the write scope ("Add to Google Calendar")

The app now also requests `calendar.events.owned`, the first time a member
adds an agreed meeting straight to Google. Declaring it on the consent screen
is what lets it go through verification later. Hand this to a browser agent:

---

Go to `https://console.cloud.google.com/auth/scopes` (it may be labelled
**Google Auth Platform → Data Access**) with the **Overlap** project selected
in the top bar.

Click **Add or remove scopes**. In the filter box paste:
`https://www.googleapis.com/auth/calendar.events.owned`
Tick it and click **Update**, then **Save**. Leave `calendar.freebusy` in place.

**Report back the exact label Google shows for the new scope: "Non-sensitive",
"Sensitive", or "Restricted".** If it is Sensitive, tell me what the page says
about verification (whether a "Prepare for verification" or similar button
appears), but do not submit anything.

Do not change the publishing status.

---
