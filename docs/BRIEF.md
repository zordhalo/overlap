# Overlap — build brief (read this first, every agent)

You are one of several agents building **Overlap** in parallel, overnight, with
no human available. Read `docs/PLAN.md` for the product. This file is the
contract you must not break.

## Absolute rules

1. **File ownership is exclusive.** Write ONLY the files assigned to you in your
   prompt. If you believe you need to change a file you do not own, do not touch
   it — state the need in your final report instead. A collision silently
   destroys another agent's work and nobody is awake to notice.
2. **The tree is already scaffolded.** `package.json`, `tsconfig.json`,
   `next.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`
   exist and are correct. Do not modify them. Do not run `npm install` (it is
   already running or done). If you need a dependency that is not listed below,
   do not add it — solve it with what is present or report it.
3. **TypeScript strict, and it must compile.** `noUncheckedIndexedAccess` is on,
   so `arr[0]` is `T | undefined`. `verbatimModuleSyntax` is on, so use
   `import type { X }` for type-only imports. Run `npx tsc --noEmit` before you
   finish and fix what you caused.
4. **No `any`.** No `@ts-expect-error` without a one-line reason comment.
5. **Comments explain why, not what.** Match the density of the reference repo:
   a short block above a non-obvious decision, nothing above a getter.
6. Keep files under 500 lines. Validate input at boundaries.
7. Do not commit secrets. Do not create documentation files beyond what you are
   asked for.

## Stack (pinned, installed)

Next.js 16.3.5 (App Router) · React 19.3.0 · TypeScript 5.9.3 (**not** 7.x) ·
Tailwind v4.3.3 (`@import "tailwindcss"`, CSS-first config, no tailwind.config) ·
Drizzle 0.45.2 + `@neondatabase/serverless` 1.1.0 · Luxon 3.7.2 · cobe 2.0.1 ·
nanoid 6.0.1 · vitest 5.0.1.

Path alias: `@/*` → `./src/*`.

## Layout and ownership map

```
src/lib/schedule/**      engine agent
src/lib/ics/**           pages agent
src/lib/db/**            data agent
drizzle/**               data agent
src/lib/crypto.ts        data agent
src/app/globals.css      design agent
src/components/ui/**     design agent
src/app/fonts/**         design agent
src/components/globe-theme.ts             design agent
src/components/globe.tsx globe agent
src/components/timeline.tsx, slots.tsx   timeline agent
src/app/**/page.tsx, layout.tsx, api/**  pages agent

FROZEN, owned by the integrator, do not touch:
src/lib/schedule/types.ts
src/lib/time/clock.tsx
```

## The engine contract (everyone codes against this)

`src/lib/schedule/types.ts` **already exists and is FROZEN.** The integrator
wrote it in Wave 0. No agent may modify, extend, or re-declare anything in it —
import from it. If a shape you need is genuinely missing, say so in your final
report; do not add it yourself. Read the real file rather than the excerpt
below, which is abridged.

`src/lib/time/clock.tsx` also already exists and is frozen: it exposes
`useClock()` → `{ focusInstant, isLive, focus, resumeLive }` and
`usePrefersReducedMotion()`. The globe and the timeline both subscribe to it so
they behave as one instrument rather than two widgets.

```ts
/** Half-open interval of absolute time, [start, end). Epoch milliseconds. */
export type Interval = { start: number; end: number };

export type Member = {
  id: string;
  name: string;
  /** IANA zone, e.g. "America/Toronto". */
  timezone: string;
  /** Local wall-clock minutes from midnight. sleepStart may exceed sleepEnd
   *  (a window crossing midnight); callers must not assume ordering. */
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  /** Absolute busy intervals from a calendar, already in epoch ms. */
  busy: Interval[];
};

export type MemberCost = {
  memberId: string;
  /** 0 = inside working hours, 2 = awake but off-hours, 10 = near sleep. */
  penalty: number;
  reason: 'work' | 'off-hours' | 'early' | 'late';
};

export type Slot = {
  start: number;
  end: number;
  /** Sum of member penalties. Lower is better. */
  score: number;
  /** Spread of penalties across members; breaks ties toward shared cost. */
  variance: number;
  costs: MemberCost[];
};

export type SuggestResult =
  | { kind: 'slots'; slots: Slot[] }
  /** No slot fits. `blockers` names who to talk to, so the UI is never empty. */
  | { kind: 'none'; blockers: { memberId: string; blockedMinutes: number }[] };
```

## Time-math rules (non-negotiable)

- **All stored and computed time is epoch milliseconds, UTC.** Local wall-clock
  values exist only as `(zone, minutes-from-midnight)` pairs and are resolved
  through Luxon at the moment of use.
- Never construct a local time by adding an offset. Use
  `DateTime.fromObject({...}, { zone })` and let Luxon resolve it.
- A local time that does not exist (spring-forward gap) comes back from Luxon as
  `invalid`. Handle it explicitly — do not let an invalid DateTime become `NaN`
  downstream.
- A local time that occurs twice (fall-back) must be covered once.
- Intervals are half-open `[start, end)` everywhere. This is what makes merge and
  subtract composable without off-by-one.

## cobe 2.0.1 API notes (for the globe agent)

`createGlobe(canvas, opts)` returns `{ update(partial), destroy() }`.
Options: `devicePixelRatio, width, height, phi, theta, dark, diffuse, scale,
mapSamples, mapBrightness, baseColor, markerColor, glowColor, markers, arcs,
onRender(state)`.
- `markers: { location: [lat, lng], size: number, color?: [r,g,b] }[]` — colors
  are 0..1 floats, not 0..255. Per-marker `color` overrides `markerColor`.
- `arcs: { from: [lat,lng], to: [lat,lng] }[]` is supported.
- **There is NO `onRender` in cobe 2.0.1.** Both the published docs and cobe's
  own README describe an `onRender(state)` frame callback. It does not exist in
  this build — verified by reading `node_modules/cobe/dist/index.esm.js`, which
  contains no animation loop at all. The globe renders once on `createGlobe` and
  again only when you call `update(partial)` explicitly. Drive animation from a
  `requestAnimationFrame` loop you own, calling `update({ phi, theta })`.
  (This turned out better for the reduced-motion requirement: not starting the
  loop means zero rendering, rather than a frozen loop still ticking.)
- Canvas needs explicit `width`/`height` attributes at 2x the CSS size.
- Always `destroy()` on unmount, and re-create on resize.

## Definition of done, for you

- The files you own exist, are complete, and have no TODO stubs that a caller
  would hit at runtime.
- `npx tsc --noEmit` reports no error originating in your files.
- If you own tests, `npx vitest run` passes them.
- Your final report states: what you built, what you deliberately left out, any
  file you wanted to touch but did not, and anything the integrator must wire up.

## Cut from scope (do not build)

**Google OAuth / Google Calendar API.** Removed in review: it cannot be
exercised by morning because it needs a hand-created Cloud Console client, and
dormant code still has to compile and not break the build. `src/lib/google/**`
does not exist and must not be created. The calendar path is a pasted secret
iCal URL plus `.ics` file upload, nothing else.

**Fairness across meetings.** The scorer has no memory of who took the last
early call. Never write UI copy claiming the burden rotates.
