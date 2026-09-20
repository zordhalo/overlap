# Connecting Google Calendar

Overlap can read a member's free/busy directly from Google instead of asking
them to paste a secret iCal URL. This is optional: with `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` unset, the button never appears and nothing changes.

## What Overlap asks Google for

**One scope, and only one:**

```
https://www.googleapis.com/auth/calendar.freebusy
```

The `freeBusy` endpoint returns `{ start, end }` pairs. It does not return
titles, attendees, or locations — there is nothing in the response to leak,
log, or store. Overlap's promise that it records *that* you are busy and never
*what* is enforced by Google's API surface, not by our own discipline.

Adding the agreed meeting to a calendar deliberately does **not** use OAuth.
That would require `calendar.events` ("view and edit events on all your
calendars") to do something the `.ics` download already does everywhere. One
narrow scope beats two.

## Read this before you start

**Google revokes refresh tokens after 7 days while the app's publishing status
is "Testing" and its user type is "External".** Every connected calendar will
silently stop syncing a week later. There are three ways out:

| Option | Works for | Cost |
|---|---|---|
| **Internal** user type | Only accounts in your Google Workspace org | No verification, no 7-day limit. Co-founders outside the org cannot connect. |
| **In production** | Anyone | Sensitive scopes need Google's verification review first. |
| Stay in **Testing** | Up to 100 named test users | Free and instant, but everyone reconnects weekly. |

Testing mode is fine for trying it with two or three people this week. It is
not something to leave running.

The Cloud Console labels each scope **non-sensitive**, **sensitive**, or
**restricted** next to it when you add it. That label decides whether going to
production needs a review, so read it rather than assuming — the agent prompt
below is written to report it back to you.

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

9. Under **Authorised redirect URIs**, add these two, exactly as written,
   with no trailing slash:
   ```
   https://overlap-advancelabs.vercel.app/api/google/callback
   http://localhost:3000/api/google/callback
   ```
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
