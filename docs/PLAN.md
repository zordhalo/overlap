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

Everything reduces to interval algebra on absolute UTC instants. Intervals are
half-open `[start, end)` everywhere.

**Two tiers of unavailability. This distinction is the whole design.**

```
HARD (removed from the candidate set entirely):
  sleep(m)          a slot inside someone's sleep window is not a meeting
  calendarBusy(m)   they are already committed

SOFT (stays a candidate, gets penalised by the scorer):
  offHours(m)       awake, but outside their working hours

free(all) = horizon \ ⋃ ( sleep(m) ∪ calendarBusy(m) )
slots     = windows of `duration` inside free(all), stepped by 15 min
score     = Σ penalty(m, slot)   over all members
```

> **Why this is written this way.** v1 of this plan put `offHours` in the
> hard-exclusion set *and* gave it a `+2` penalty in the scorer. Those cannot
> both be true: if off-hours time is already removed from `free(all)`, no
> candidate slot can ever fall in it, and the `+2` branch is dead code by
> construction. Sleep and calendar conflicts are hard; off-hours is soft. Caught
> in review.

### Interval generation: the required strategy, not a suggestion

Sleep and off-hours windows are **per-local-calendar-day**. Generate them by
walking each local day across the horizon **and resolving that zone's UTC offset
for that day**. Never compute one offset and add it repeatedly — that is the bug
that ships DST regressions, and it passes every same-zone test.

**Luxon behaves differently from how v1 of this plan claimed.** Verified in
review:

- **Spring-forward gap:** Luxon does **not** mark a nonexistent local time
  invalid. `DateTime.fromObject({ hour: 2, minute: 30 }, { zone })` on the
  transition day **silently advances to 03:30**. `isValid` is for unsupported
  zone names, not gap detection. Do not use `isValid` to detect a gap.
- **Fall-back ambiguity:** Luxon's own docs call the repeated hour
  **"undefined ... should not be relied upon."** Two construction paths for the
  same nominal local time can return different offsets.

So the engine must **not** reason about local times that may or may not exist.
Instead, derive boundaries by **offset-diffing on real instants**: construct a
candidate instant, read `.offset` on it, and clamp/merge the resulting interval
against its neighbours. A window is defined by the instants at its edges, never
by trusting that a wall-clock string round-trips. Any gap or repeat then falls
out of the merge step automatically, because merging half-open intervals is
idempotent over the duplicated hour and continuous over the missing one.

### Correctness cases that must have tests

1. Sleep window crossing midnight (`22:00 → 07:00`) yields two intervals per
   local day, not one negative one.
2. Zones at the horizon extremes (UTC+14 vs UTC−11) still get the right number
   of local days.
3. Spring-forward: no phantom or duplicated interval on the transition day.
4. Fall-back: the repeated hour is covered exactly once.
5. Half-hour (`Asia/Kolkata`, +05:30) and 45-minute (`Asia/Kathmandu`, +05:45)
   zones align to the 15-minute grid.
6. An all-day iCal event blocks the member's whole **local** day, not
   00:00–00:00 UTC.
7. A member with no calendar is free outside sleep, never busy.
8. Empty overlap returns a clear "no slot" result **plus the closest near-miss
   and who blocks it**, never an empty screen.
9. **A horizon spanning a DST transition in one member's zone but not
   another's** (a Toronto member transitioning mid-week while a London or
   Kolkata member does not): the non-transitioning member's intervals must not
   shift, and the transitioning member's must shift on exactly the right local
   day. This is the case that catches a memoized offset; cases 3 and 4 do not,
   because they are single-zone. Added in review.
10. `offHours` is soft: a slot outside everyone's working hours but inside
    nobody's sleep **must still be returned**, carrying a nonzero score. This is
    the regression test for the v1 contradiction above.

### Burden score

Per member, per candidate slot:

| Condition | Penalty | Shown as |
|---|---|---|
| Inside working hours | 0 | — |
| Awake, outside working hours | 2 | "outside <name>'s hours" |
| Within 1h of a sleep boundary | 25 | "an early start for <name>" / "a late night for <name>" |

`score = Σ penalty`. 25 rather than 10 for the sleep boundary: at six members
`2 × 6 = 12` would otherwise outrank dragging one person to the edge of their
sleep, so the ranker would prefer hurting one person badly to mildly
inconveniencing everyone. See §10, Okonkwo #9. **Ship this alone first.** Variance across members is
computed and stored on the slot but is used only to break exact score ties, and
it must never block the ranked list from rendering.

**Honesty about what this is.** It is a stateless per-request total-pain
minimiser. It is *not* fairness across meetings — it has no memory of who took
the last early call. The UI must therefore say "costs Matthew an early start,"
which is true, and must not claim to rotate the burden, which it does not do.
Real rotation needs meeting history and is out of scope tonight.


## 5. Data model

```sql
circle  (id, slug, name, created_at, duration_minutes, horizon_days)
member  (id, circle_id, name, timezone, sleep_start, sleep_end,
         work_start, work_end, ics_url_encrypted, tag, color,
         lat, lng, created_at)
busy    (id, member_id, starts_at, ends_at, source, synced_at)
```

- **`busy` has no `summary` column, deliberately.** Overlap needs to know *that*
  someone is busy, never *what* they are doing. A column that does not exist
  cannot leak one co-founder's meeting titles to the rest of the circle, and no
  feature reads it, so removing it costs nothing. Removing data beats guarding it.
- `slug` is a **capability URL**: holding the link is the only authorisation, so
  it is high-entropy `nanoid` (≥16 chars), never derived from the circle name,
  and nothing anywhere lists circles or permits slug enumeration.
- `ics_url_encrypted` is encrypted at rest with AES-256-GCM, fresh random 12-byte
  IV per record, auth tag verified on decrypt. A secret iCal URL grants read
  access to a person's whole calendar — it is a credential, not a setting.
- Wall-clock fields are integers, local minutes from midnight (0..1439), with
  `sleep_start > sleep_end` legal and normal.
- `busy` is a cache with a TTL. **A failed calendar fetch keeps the previous
  rows rather than clearing them**: losing busy data silently turns "busy" into
  "free", which is the worst direction for a scheduler to fail in.
- No email column. Nothing sends email tonight, so nothing collects an address.


## 6. Visual design — the runs-on.dev language

Reused deliberately, from `~/zGithub/runs-on.dev/app/globals.css`. Written fresh
here, speaking the identical language.

**Tokens**
```
--paper   #101010  obsidian, page canvas      --ink     #f3f3f3  chalk, primary type
--card    #080808  carbon, deepest surface    --muted   #9c9c9c  smoke, secondary type
--rule    #212121  graphite, hairline         --signal  #ffffff  the one action colour
--pulse   #98ff38  reserved: the overlap      --flag    #d97757  errors
```

**Type:** Bitcount Prop Single (headings, pixel-matrix) · Satoshi (body, 400 at
every size) · IBM Plex Mono (meta labels, uppercase, `0.08em` tracking).
**Hierarchy comes from scale and negative tracking, never from bold.**

**Signature move — slit lines.** Every rule and frame is a line of light whose
ends fade into the canvas; card frames are four such lines that overshoot and
cross at the corners, technical-drawing style. No hard rectangles, no shadows,
no gradients-as-decoration. Reimplemented here, not copied.

**Applying the language to Overlap's new surfaces** (so agents do not invent):
- Slot cards → `.slit-frame`, generous gaps so corner crossings never touch.
- The iCal URL field and every input → `.slit-input`.
- Section labels, timezone names, UTC offsets, member tags → `.meta`.
- The circle name on the circle page → display scale (63px), negative tracking.
- One filled white pill per screen, maximum. On the circle page it is
  "Add to calendar" on the top-ranked slot. Nothing else is filled.

### Timeline band encoding — specified values, not adjectives

Reviewed finding: v1 assigned near-white `chalk` to *free*, which contradicts
"the answer is the brightest thing on screen" — a member is free for most of the
day, so the strip would glow everywhere. Corrected. All fills are white at the
stated alpha over `--paper`, except the overlap.

| State | Fill | Distinguished by |
|---|---|---|
| Asleep | `#080808` (carbon), plus a 1px `--slit-dim` baseline so the row stays traceable | value (void) |
| Off-hours | `rgba(255,255,255,0.10)` | value |
| Busy (calendar) | `rgba(255,255,255,0.10)` + 45° hatch, `rgba(255,255,255,0.22)`, 4px pitch | **texture**, not value |
| Free | `rgba(255,255,255,0.26)` | value |
| **Overlap** | `#98ff38` at 0.85 | **the only saturated element on the page** |

Busy is separated from off-hours by texture rather than value, so the encoding
survives both greyscale and a compressed screenshot. Nothing relies on hue alone.

**Member identity** never relies on colour alone: every member carries a
two-letter uppercase mono tag *and* a tint, from a restrained set that holds up
on obsidian — `#7fb2ff` ice, `#c9a227` brass, `#8fd9c0` mint, `#c58fd9` orchid,
`#d9a08f` clay, `#9fa8b8` steel. `--pulse` is reserved for the overlap and must
never be assigned to a member.

### The shared clock — globe and timeline are one instrument

Reviewed finding: as split across two agents, the globe and timeline would ship
as two unrelated widgets that both happen to show time. They share one state.

`src/lib/time/clock.tsx` (owned by the integrator, frozen before Wave 2) exposes
a single `focusInstant` — "the moment the page is currently talking about,"
defaulting to now and moving when the user scrubs or selects a slot. Both
surfaces subscribe:

- The **globe** orients its day/night terminator to `focusInstant`, so the
  daylight you see is the daylight at the time under discussion.
- The **timeline** draws its "now" line and scrubber at `focusInstant`.
- Selecting the top-ranked slot sets `focusInstant` to it. **You see the
  answer**: Toronto in daylight, London in the evening, nobody in the dark.

That is what earns the globe its place. Without this binding it is a party trick.

### cobe theme — pinned, not improvised

cobe's defaults (atmosphere glow, halo'd markers, soft base) read as generic
WebGL-globe tutorial and fight a system defined by no decorative glow. Pinned as
a Wave 1 design deliverable in `src/components/globe-theme.ts`:

```
dark: 1,  diffuse: 0,  glowColor: [0.063, 0.063, 0.063]   // = --paper, i.e. no halo
baseColor:   [0.129, 0.129, 0.129]   // --rule graphite sphere
markerColor: [0.612, 1.0, 0.220]     // --pulse, overridden per member by tint
mapBrightness: 2.2,  mapSamples: 16000,  scale: 1
```

Per-marker `color` comes from the member tint (cobe takes 0..1 floats, not
0..255). No arcs unless they carry meaning.

### Motion, and its absence

Reviewed finding: the reference CSS kills animation *durations and delays*
separately because zeroing duration alone left stagger delays running. The
highest-motion surface this language has ever carried cannot be silent on this.

Under `prefers-reduced-motion: reduce`:
- Globe **auto-rotation stops entirely**. It freezes oriented to `focusInstant`.
  Drag still works, because that is user-initiated.
- The overlap band's glow becomes a **static fill** — no pulse, the way
  `.pulse-dot` is hard-disabled in the reference.
- The "now" line still *moves*, because its position is information, not
  decoration. It simply moves without transition.

### Mobile (390px)

The answer matters most on a phone, so the hierarchy inverts: **ranked slots
first, timeline second, globe last** as a collapsed "tap to expand" card.
Auto-rotation is off by default under 640px regardless of motion preference —
a spinning WebGL sphere is a battery cost a phone user did not ask for.


## 7. Build waves (parallel agents, disjoint file ownership)

No two agents may write the same file. Ownership is absolute. A collision
silently destroys work nobody is awake to notice.

**Wave 0 — the frozen contract (integrator, before any agent starts)**
Reviewed finding: eight agents coding against each other's *assumed* interfaces
is the real failure mode — it produces "nothing deploys," not "a bug." So the
shared types are written first, by one hand, and are immutable thereafter.

| Owns | Deliverable |
|---|---|
| `src/lib/schedule/types.ts` | `Interval`, `Member`, `MemberCost`, `Slot`, `SuggestResult`. **Frozen. No agent may modify it.** |
| `src/lib/time/clock.tsx` | The shared `focusInstant` context both globe and timeline subscribe to. |

**Wave 1 — foundations (3 parallel)**
| Agent | Owns | Deliverable |
|---|---|---|
| `engine` | `src/lib/schedule/*` except `types.ts` | Pure engine + vitest suite, all 10 cases green. Offset-diffing, per-local-day generation. |
| `data` | `src/lib/db/**`, `drizzle/**`, `src/lib/crypto.ts` | Schema, queries behind a single module boundary, AES-256-GCM helpers |
| `design` | `src/app/globals.css`, `src/components/ui/**`, `src/app/fonts/**`, `src/components/globe-theme.ts` | Tokens, slit primitives, band values, pinned cobe theme |

**CHECKPOINT A (integrator, serial).** `tsc --noEmit` + `vitest run` across
Wave 1 before Wave 2 is allowed to start. Reviewed finding: one integration pass
at the end is too late to discover drift.

**Wave 2 — surfaces (3 parallel, import the frozen types)**
| Agent | Owns | Deliverable |
|---|---|---|
| `globe` | `src/components/globe.tsx` | cobe globe on the pinned theme, member markers, terminator driven by `focusInstant`, reduced-motion + mobile rules |
| `timeline` | `src/components/timeline.tsx`, `slots.tsx` | Bands at the specified values, scrubber bound to `focusInstant`, ranked slots with honest burden copy |
| `pages` | `src/app/**/page.tsx`, `layout.tsx`, `src/app/api/**`, `src/lib/ics/**` | Routes, join flow, server actions, iCal parse + secret-URL sync |

**CHECKPOINT B (integrator, serial).** Typecheck, test, build.

**Wave 3 — integration (integrator, serial).** Real-data smoke test, Playwright
screenshots at 1440 + 390, Neon provisioning, Vercel deploy, GitHub publish.

**Wave 4 — final review (3 parallel personas)** on the shipped product.

### Priority spine, if the night runs short

`engine → pages → deploy` is the spine; it alone passes the acceptance test,
because a member with no calendar is simply free outside sleep. Degrade in this
order, and say so in the morning report rather than shipping something half-wired:

1. **Never cut:** engine, data, design, pages, deploy.
2. **Cut last:** the globe. It is an explicit user request ("have like a globe
   to show the location", "very very sexy"), so it is scope, not polish — but it
   is the one thing whose absence still leaves a working product.
3. **Cut first:** iCal sync. Sleep + working hours alone produce the ranked list.
4. **Already cut:** Google OAuth (see resolutions).


## 8. Definition of done

1. `npm run typecheck && npm test && npm run build` all green.
2. Public repo at `github.com/zordhalo/overlap`, AGPL-3.0, real README.
3. Live Vercel URL, reachable, no auth wall.
4. **The acceptance test:** Lucas opens the link, creates a circle, adds himself
   (Toronto) and two co-founders in their real zones, and gets a ranked list of
   meeting times for this week that respect everybody's sleep.
5. **The cold-open test** (added in review — this is the actual product bet):
   the join link works for someone arriving with **no prior context and no
   cookie**. Verified by driving the join flow in a fresh browser context end to
   end, with no guidance available on screen beyond what the page itself says.
   The thesis is collapsing the *co-founder's* side of the round trip; testing
   only Lucas's side tests the wrong half.
6. Screenshots captured at 1440 and 390 and shown to Lucas as the first render.
7. Every unimplemented thing named explicitly in the morning report. No silent gaps.


## 9. Known risks, stated up front

| Risk | Mitigation |
|---|---|
| Google OAuth needs a human in Cloud Console | Primary path is iCal URL, which needs nobody. OAuth ships dormant + documented. |
| cobe marker positions could be visually wrong and nobody's awake to notice | Playwright screenshot + a unit test on the lat/lng → marker transform. |
| Parallel agents collide on files | Absolute disjoint ownership, enforced above. Integration is serial and mine. |
| DST bug ships silently | 8 named engine test cases are a gate, not a suggestion. |
| Neon provisioning needs interactive auth | Fall back to a local-first SQLite/file store behind the same query interface; swap later without touching callers. |

---

## 10. Review resolutions (plan v2)

Three reviewers read v1. All three returned **APPROVE WITH CHANGES**; none
rejected. Every required change is resolved below. v1 is preserved in git history.

### Mara Voss — product and scope

| # | Required change | Resolution |
|---|---|---|
| 1 | Cut Google OAuth entirely, not even dormant | **Accepted in full.** Removed from scope, schema, and env. The argument is correct: it cannot be exercised by 9am because it needs a hand-created Cloud Console client, and dormant code still has to compile. `src/lib/google/**` deleted from the tree. Documented as future work only. |
| 2 | Demote iCal sync and the globe to droppable | **Accepted for iCal. Overridden for the globe.** iCal is now "cut first" in the priority spine. The globe stays in scope: Lucas explicitly asked for "a globe to like show the location" and for the thing to be "very very sexy" — that makes it requested scope, not polish, and quietly dropping it would be substituting my judgement for his instruction. It is ranked "cut last," so it is the first casualty if the night genuinely runs out, and its absence is reported rather than hidden. Mara was reviewing the plan, not the original request, so she could not see that. |
| 3 | Freeze shared types before Wave 2; add a mid-flight checkpoint | **Accepted, and strengthened.** Types move to a new **Wave 0** written by the integrator before any agent starts, and are immutable — not produced by an agent that might revise them. Two checkpoints added (A after Wave 1, B after Wave 2). |
| 4 | Plain summed penalty; defer variance tie-breaking | **Accepted.** Sum ships first and alone determines rank; variance is stored but only breaks exact ties, and can never block the list rendering. |
| 5 | Acceptance test must include a co-founder joining from the link alone | **Accepted.** Added as DoD item 5, the "cold-open test," driven in a fresh browser context with no cookie. She is right that the thesis is the co-founder's half of the round trip. |

### Dr. Adaeze Okonkwo — correctness, data model, security

| # | Required change | Resolution |
|---|---|---|
| 1 | Off-hours cannot be both hard-excluded and penalised — the `+2` branch was dead code | **Accepted; this was a real bug in v1.** Section 4 now separates HARD (sleep, calendar) from SOFT (off-hours). Test case 10 added as the regression guard. |
| 2 | State per-local-day offset recomputation as the required strategy | **Accepted.** Written as a requirement, with the reason it gets skipped under time pressure. |
| 3 | Missing test case: DST transition in one member's zone but not another's | **Accepted** as case 9, with the explanation of why cases 3 and 4 do not catch a memoized offset. |
| 4 | The plan's Luxon justification is factually wrong | **Accepted, and it changes the implementation.** Luxon silently advances a spring-forward gap time rather than invalidating it, and calls fall-back ambiguity "undefined." The engine now derives boundaries by **offset-diffing on real instants** instead of trusting wall-clock round-trips. My v1 claim that Luxon reports the gap as invalid was simply incorrect. Luxon is kept; the stated reason for keeping it is fixed. |
| 5 | The "fairness" claim is not implemented | **Accepted.** The scorer is a stateless per-request pain minimiser with no memory of past meetings. The UI must say "costs Matthew an early start" and must not claim to rotate burden. Real rotation needs meeting history; out of scope. |
| 6 | **SSRF: `ics_url` is a user-supplied URL the server fetches** | **Accepted — this was a real vulnerability, not a hardening nit.** Any member could paste `169.254.169.254` or an internal address and use the server as a proxy. `src/lib/url-guard.ts` now resolves the hostname via DNS and rejects unless **every** resolved address is public — loopback, link-local, private, CGNAT, unique-local, `0.0.0.0/8`, multicast all refused, scheme restricted to http/https, embedded credentials refused. Checking the resolved IP rather than the hostname is the point: a hostname can resolve to a private address, so hostname allowlisting is bypassable. Residual DNS-rebinding risk is documented rather than silently accepted. |
| 7 | Cache refresh needs a timeout, last-known-good on failure, and single-flight dedup | **Accepted.** 8s `AbortSignal.timeout`; a timeout counts as failure and keeps the previous rows; per-instance promise map dedups concurrent viewers, commented honestly as per-instance rather than global. |
| 8 | `busy.summary` must never be serialized to another member | **Accepted and exceeded.** The column does not exist at all, so there is nothing to leak or to guard. |
| 9 | The variance tie-break does not deliver the fairness the prose claims | **Accepted; the scoring changed.** He is right that at six members `2x6 = 12` outranks a lone `10`, so the scheme preferred making one person suffer badly over mildly inconveniencing everyone. Near-sleep penalty raised **10 → 25** so it dominates realistic group sizes, and ranking is now `(score, maxPenalty, variance)` — `maxPenalty` as the second key is what stops a single-victim slot winning. The fairness claim is also scoped honestly: this spreads cost *within one meeting's candidates*; it has no memory across meetings and cannot rotate burden. Real rotation needs meeting history, which recurring series would require anyway, and both are out of scope. |
| 10 | IDs must not be sequential; cookie needs `Secure`/`SameSite` | **Accepted.** nanoid/UUID ids so member and circle ids are not an enumeration surface independent of the slug. |
| — | Rate-limit join/lookup | **Acknowledged, not built — a named gap.** A per-instance limiter is close to useless across serverless invocations and a Postgres-backed one is more machinery than tonight warrants. The real control is slug entropy (≥16 chars, random, no listing surface anywhere). Recorded here rather than papered over. |

### Juno Park — design and UX

| # | Required change | Resolution |
|---|---|---|
| 1 | Move "free" off chalk so the overlap is the brightest element | **Accepted; this was a real self-contradiction.** Free is now `rgba(255,255,255,0.26)`. |
| 2 | Explicit reduced-motion spec for globe and glow | **Accepted.** Auto-rotate stops entirely, glow becomes static fill, and the "now" line keeps moving because its position is information, not decoration. |
| 3 | Shared clock binding the globe's terminator to the timeline scrubber | **Accepted — the single best idea in all three reviews.** Promoted to Wave 0 as `focusInstant`, written before the two agents split. This is what turns the globe from a party trick into the thing that shows you the answer. |
| 4 | Pin an explicit cobe theme | **Accepted.** `globe-theme.ts` is a Wave 1 design deliverable with `diffuse: 0` and the glow colour set to `--paper`, killing the default atmosphere. |
| 5 | Replace adjective band encoding with real values | **Accepted.** Table of alpha values, with busy separated by **texture** rather than value so the encoding survives greyscale. |
| 6 | Specify the 390px globe treatment | **Accepted.** Hierarchy inverts on mobile — slots first, globe last as a collapsed card — and auto-rotate is off under 640px on battery grounds. |
| + | Reuse the live-pulse pattern as a real clock | **Accepted**, and it is the same mechanism as #3. |
