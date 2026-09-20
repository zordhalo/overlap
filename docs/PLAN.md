# Overlap — implementation plan

**One line:** See your people's time zones on a globe, and get ranked meeting
times when everyone is awake and free.

**Repo:** `zordhalo/overlap` (public, AGPL-3.0-only, matching its sibling runs-on.dev)
**Deploy:** Vercel (`advancelabs` team) → later `overlap.runs-on.dev`
**Status:** plan under review. No code written until 3 reviewers approve.

---

## 1. The problem, stated precisely

Lucas coordinates with co-founders at Converg3nce and others across time zones.
The recurring cost is not the meeting, it is the *negotiation about when the
meeting is*. Current state: N rounds of async messages proposing times, each
person mentally converting into their own zone, each round leaking a day.

The product must collapse that to: **share one link → everyone lands on a page
that already knows the answer.**

The failure mode to avoid: building a calendar app. This is not a calendar. It
is a *single-question* tool. The question is "when."

---

## 2. Product decisions (made, not deferred)

| Decision | Choice | Why |
|---|---|---|
| Name | **Overlap** | The overlap *is* the meeting. Describes the output, not the mechanism. |
| Unit of collaboration | **Circle** — a named group with a share link | Matches how Lucas actually works: a standing set of people (co-founders), reused weekly, not a one-off poll. |
| Onboarding | **No account required.** Open link → set name + zone → done | Friction is the whole reason the current process fails. An auth wall guarantees a co-founder never finishes. |
| Identity | Signed HTTP-only cookie holding `member_id` | Lets someone return and edit themselves without a password. |
| Calendar (primary) | **Secret iCal URL** paste (Google/Outlook/Apple all expose one) | Zero OAuth, zero cloud-console setup, works tonight. This is the key unlock. |
| Calendar (secondary) | Google OAuth read + event insert, **gated behind env vars** | Nicer UX, but requires a Google Cloud OAuth client Lucas must create by hand. Ships complete and dormant. |
| Availability floor | Per-member **sleep window** + **working hours**, both editable | "Free at 4am" is not free. This is the insight most schedulers miss. |
| Output | Ranked slot list + one-click `.ics` download / Google event | Must end in a real calendar entry or it did not solve the problem. |
| Fairness | Explicit **burden score** so the same person isn't always taking 06:00 | Differentiator, and it is the thing that makes a group actually adopt it. |

### Explicitly out of scope for tonight
- Recurring meeting series
- Mobile native app
- Team billing / paid tiers
- Editing other people's availability
- Timezone *travel* (a member temporarily in another zone) — schema allows it, UI does not expose it

---

## 3. Architecture

```
overlap/
├── src/
│   ├── lib/schedule/          ← PURE. no React, no DB, no fetch.
│   │   ├── types.ts
│   │   ├── intervals.ts       merge / intersect / subtract interval sets
│   │   ├── availability.ts    member → busy intervals (sleep, work, calendar)
│   │   ├── suggest.ts         ranked slot search + burden scoring
│   │   └── *.test.ts          vitest, DST + midnight-crossing cases
│   ├── lib/ics/               iCal parse (RFC 5545 subset) + generate
│   ├── lib/db/                drizzle schema + queries
│   ├── lib/google/            OAuth + Calendar API (env-gated)
│   ├── app/                   Next.js 16 App Router
│   │   ├── page.tsx                   landing / create a circle
│   │   ├── c/[slug]/page.tsx          the circle: globe + timeline + slots
│   │   ├── c/[slug]/join/page.tsx     set yourself up
│   │   └── api/…
│   └── components/
│       ├── globe.tsx          cobe WebGL globe, markers, day/night
│       ├── timeline.tsx       24h bands per member + scrubber
│       ├── slots.tsx          ranked suggestions
│       └── ui/                design-system primitives
└── docs/
```

**Stack:** Next.js 16 · React 19 · TypeScript (strict) · Tailwind v4 ·
Drizzle + Neon Postgres · Luxon (server time math) · cobe (globe) · vitest.

**Why TypeScript** when runs-on.dev is plain JS: this is being built overnight by
parallel agents with no human reviewing intermediate states. `tsc --noEmit` is
the cheapest available correctness gate. It is the difference between "it
compiles" and "we find out at 9am."

**Why Luxon** over `Intl` alone: DST arithmetic. `Intl` can *format* in a zone;
Luxon can answer "what is 02:30 on the spring-forward day in America/Toronto"
(answer: it does not exist) without hand-rolling the edge case.

**Why cobe** over three.js: it is ~5kb, dot-matrix rendered, and the dot texture
rhymes directly with the existing runs-on.dev dot-map hero. Same visual family,
a fraction of the weight.

---

## 4. The scheduling engine (the part that must be right)

Everything reduces to interval algebra on absolute UTC instants.

```
for each member m:
  busy(m) = sleepIntervals(m) ∪ offHoursIntervals(m) ∪ calendarBusy(m)
free(all) = horizon \ ⋃ busy(m)
slots     = windows of `duration` that fit inside free(all), stepped by 15min
```

**Correctness cases that must have tests:**
1. Sleep window crossing midnight (`22:00 → 07:00`) produces two intervals per local day, not one negative one.
2. A member in a zone where the horizon day count differs (UTC+14 vs UTC-11) still gets the right number of local days.
3. Spring-forward: a 02:00–03:00 local sleep boundary on the transition day does not produce a phantom or duplicated interval.
4. Fall-back: the repeated hour is covered once, not twice.
5. Half-hour zones (`Asia/Kolkata`, +05:30) and 45-min (`Asia/Kathmandu`, +05:45) align to the 15-minute grid.
6. An all-day iCal event blocks the member's whole local day, not 00:00–00:00 UTC.
7. A member with no calendar connected is treated as free outside sleep/work, never as busy.
8. Empty overlap returns a clear "no slot" result plus the *closest near-miss* (who blocks it), never an empty screen.

**Burden score.** For each candidate slot, each member gets a penalty:
`0` inside working hours, `+2` outside working hours but awake, `+10` within 1h
of their sleep boundary. Slot score = sum, tie-broken by *variance* across
members (a slot costing one person 4 ranks worse than one costing four people 1
each). Displayed honestly: "costs Matthew an early start."

---

## 5. Data model

```sql
circle  (id, slug, name, created_at, duration_minutes, horizon_days)
member  (id, circle_id, name, timezone, sleep_start, sleep_end,
         work_start, work_end, ics_url, google_refresh_token, color, created_at)
busy    (id, member_id, starts_at, ends_at, source, summary, synced_at)
```

- `ics_url` and `google_refresh_token` are **encrypted at rest** (AES-256-GCM,
  key from env). An iCal secret URL is a credential — it grants read access to
  a person's whole calendar to anyone holding it.
- `busy` is a cache, refreshed on load if `synced_at` is older than 15 minutes.
- No email column. We are not sending email tonight, so we do not collect it.

---

## 6. Visual design — the runs-on.dev language

Reused deliberately, from `~/zGithub/runs-on.dev/app/globals.css`. Written fresh
here, not copied, but speaking the identical language.

**Tokens**
```
--paper   #101010  obsidian, page canvas      --ink     #f3f3f3  chalk, primary type
--card    #080808  carbon, deepest surface    --muted   #9c9c9c  smoke, secondary type
--rule    #212121  graphite, hairline         --signal  #ffffff  the one action colour
--pulse   #98ff38  live status only           --flag    #d97757  errors
```

**Type:** Bitcount Prop Single (headings, pixel-matrix) · Satoshi (body, 400 at
every size) · IBM Plex Mono (meta labels, uppercase, `0.08em` tracking).
**Hierarchy comes from scale and negative tracking, never from bold.**

**Signature move — slit lines.** Every rule and frame is a line of light whose
ends fade into the canvas; card frames are four such lines that overshoot and
cross at the corners, technical-drawing style. No hard rectangles, no shadows,
no gradients-as-decoration.

**Buttons:** one filled white pill for the single primary action; ghost outline
(slit-rendered) for secondary. Uppercase, 14px, weight 400.

**Dark only.** The reference is a dark system end to end.

**Overlap-specific additions** (new, in the same language):
- Member colours drawn from a restrained set that survives on obsidian, each
  paired with a mono two-letter tag so colour is never the only signal (a11y).
- Timeline bands: asleep = near-carbon void, off-hours = graphite, busy =
  hatched, free = chalk. The overlap band glows `--pulse` and is the only
  saturated element on the page. **The answer is the brightest thing on screen.**

---

## 7. Build waves (parallel agents, disjoint file ownership)

No two agents may write the same file. Ownership is absolute.

**Wave 1 — foundations (4 parallel)**
| Agent | Owns | Deliverable |
|---|---|---|
| `engine` | `src/lib/schedule/**` | Pure engine + full vitest suite, all 8 cases above green |
| `data` | `src/lib/db/**`, `drizzle/**` | Schema, migrations, queries, encryption helpers |
| `design` | `src/app/globals.css`, `src/components/ui/**`, fonts | Tokens + primitives, freshly written |
| `scaffold` | root configs, `README`, `LICENSE`, CI | Next 16 + TS strict + Tailwind 4 + vitest booting clean |

**Wave 2 — surfaces (4 parallel, consume Wave 1)**
| Agent | Owns | Deliverable |
|---|---|---|
| `globe` | `src/components/globe.tsx` | cobe globe, member markers, day/night terminator, click → member |
| `timeline` | `src/components/timeline.tsx`, `slots.tsx` | 24h bands, live scrubber, ranked slot list with burden copy |
| `calendar` | `src/lib/ics/**`, `src/lib/google/**` | iCal parse/generate, secret-URL sync, env-gated Google OAuth |
| `pages` | `src/app/**/page.tsx`, `src/app/api/**` | Routes, forms, server actions wiring it together |

**Wave 3 — integration (me, serial)**
Typecheck, test, build, real-data smoke test, Playwright screenshots at 1440 +
390, Neon provisioning, Vercel deploy, GitHub publish.

**Wave 4 — final review (3 parallel personas)**
Full end-to-end review of the shipped product.

---

## 8. Definition of done

1. `pnpm typecheck && pnpm test && pnpm build` all green.
2. Public repo at `github.com/zordhalo/overlap`, AGPL-3.0, real README.
3. Live Vercel URL, reachable, no auth wall.
4. **The acceptance test:** Lucas opens the link, creates a circle, adds himself
   (Toronto) and two co-founders in their real zones, and gets a ranked list of
   meeting times for this week that respect everybody's sleep. Sends the link.
5. Screenshots captured at 1440 and 390 and shown to Lucas as the first render.
6. Every unimplemented thing named explicitly in the morning report. No silent gaps.

## 9. Known risks, stated up front

| Risk | Mitigation |
|---|---|
| Google OAuth needs a human in Cloud Console | Primary path is iCal URL, which needs nobody. OAuth ships dormant + documented. |
| cobe marker positions could be visually wrong and nobody's awake to notice | Playwright screenshot + a unit test on the lat/lng → marker transform. |
| Parallel agents collide on files | Absolute disjoint ownership, enforced above. Integration is serial and mine. |
| DST bug ships silently | 8 named engine test cases are a gate, not a suggestion. |
| Neon provisioning needs interactive auth | Fall back to a local-first SQLite/file store behind the same query interface; swap later without touching callers. |
