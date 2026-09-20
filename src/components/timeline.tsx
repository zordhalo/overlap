'use client';

/**
 * One row per member, drawn against a shared horizontal time axis, plus a
 * scrubber that drives the shared `focusInstant` (see `@/lib/time/clock`).
 * The globe and this component are "one instrument" only because they both
 * read and write that same clock — this file never keeps its own notion of
 * "the current time."
 */

import { useCallback, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DateTime } from 'luxon';
import { useClock } from '@/lib/time/clock';
import { GhostButton, Meta, MemberTag } from '@/components/ui';
import type { Member, Slot } from '@/lib/schedule/types';
import { clipToWindow, toPercent, type MemberBands, type Window } from './bands';

/** Scrub + arrow-key granularity. Matches the engine's candidate-slot grid
 *  (PLAN.md: 15 minutes unless a test says otherwise), so the instant you
 *  land on by dragging is always one a slot could actually start at. */
const STEP_MS = 15 * 60 * 1000;

/** Row height in px. Kept as one constant so the gutter and the band track
 *  can't drift out of vertical alignment with each other. */
const ROW_HEIGHT = 56;
const TICK_ROW_HEIGHT = 24;
const GUTTER_WIDTH = 176;

type TimelineProps = {
  members: Member[];
  bands: MemberBands[];
  window: Window;
  /**
   * The suggested slots, drawn across every row as the one saturated element
   * on the page. Without this the timeline shows each person's availability
   * but never the thing the product exists to find — you would have to read
   * the list beside it and mentally locate the answer on the strip yourself.
   */
  slots?: Slot[];
  /** The slot the user picked, if any; drawn brighter than the rest. */
  selected?: Slot | undefined;
};

export function Timeline({ members, bands, window, slots = [], selected }: TimelineProps) {
  const { focusInstant, isLive, focus, resumeLive } = useClock();
  const trackRef = useRef<HTMLDivElement>(null);

  const bandsByMember = useMemo(() => {
    const map = new Map<string, MemberBands>();
    for (const b of bands) map.set(b.memberId, b);
    return map;
  }, [bands]);

  // The viewer's own zone, for day labels — PLAN.md is explicit that days
  // are labelled in the *viewer's* zone, and that the UI must say so rather
  // than leave it implicit.
  const viewerZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const ticks = useMemo(() => buildTicks(window, viewerZone), [window, viewerZone]);
  const focusPercent = clampPercent(toPercent(focusInstant, window));

  const instantFromClientX = useCallback(
    (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = window.from + ratio * (window.to - window.from);
      return Math.round(raw / STEP_MS) * STEP_MS;
    },
    [window],
  );

  // Mouse/touch scrubbing. Pointer events cover both without a separate
  // touch handler — a control that only answers to a mouse leaves half of
  // the people this tool is for (anyone on a phone) unable to use it.
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const instant = instantFromClientX(e.clientX);
      if (instant !== null) focus(instant);
    },
    [focus, instantFromClientX],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.buttons !== 1) return; // only while the primary button/touch is down
      const instant = instantFromClientX(e.clientX);
      if (instant !== null) focus(instant);
    },
    [focus, instantFromClientX],
  );

  // Keyboard operability: arrow keys step by the same grid the drag snaps
  // to; Home/End jump to the ends of the visible window.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          focus(Math.max(window.from, focusInstant - STEP_MS));
          break;
        case 'ArrowRight':
          e.preventDefault();
          focus(Math.min(window.to, focusInstant + STEP_MS));
          break;
        case 'Home':
          e.preventDefault();
          focus(window.from);
          break;
        case 'End':
          e.preventDefault();
          focus(window.to);
          break;
        default:
          break;
      }
    },
    [focus, focusInstant, window.from, window.to],
  );

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between gap-3">
        <Meta as="div">Days shown in your zone · {viewerZone}</Meta>
        {!isLive && (
          <GhostButton onClick={resumeLive} aria-label="Jump back to now">
            ● now
          </GhostButton>
        )}
      </div>

      {/* This element owns horizontal overflow. On a 390px viewport the
          bands scroll sideways inside it; the page itself never gains a
          horizontal scrollbar. */}
      <div className="overflow-x-auto">
        <div className="flex min-w-[720px]">
          {/* Sticky gutter: stays put as the content column scrolls under
              it, because `sticky` resolves against the nearest scrolling
              ancestor — the overflow-x-auto div above, not the page. */}
          <div
            className="sticky left-0 z-10 shrink-0 bg-(--paper)"
            style={{ width: GUTTER_WIDTH }}
          >
            <div style={{ height: TICK_ROW_HEIGHT }} />
            {members.map((m) => (
              <GutterCell key={m.id} member={m} viewerZone={viewerZone} focusInstant={focusInstant} />
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            <div className="relative" style={{ height: TICK_ROW_HEIGHT }}>
              {ticks.map((t) => (
                <Meta
                  key={t.instant}
                  as="div"
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${clampPercent(toPercent(t.instant, window))}%` }}
                >
                  {t.label}
                </Meta>
              ))}
            </div>

            {members.map((m) => (
              <MemberRow key={m.id} bands={bandsByMember.get(m.id)} window={window} />
            ))}

            {/* The answer. Every suggested slot painted across all rows in the
                one saturated colour this design system allows, so the eye lands
                on it before it reads anything. Non-interactive: picking happens
                in the slot list, and this layer must not eat scrub gestures. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0"
              style={{ top: TICK_ROW_HEIGHT }}
            >
              {slots.map((slot) => {
                const box = clipToWindow({ start: slot.start, end: slot.end }, window);
                if (!box) return null;
                const isSelected =
                  selected !== undefined &&
                  selected.start === slot.start &&
                  selected.end === slot.end;
                const isBest = slots[0] === slot;
                const prominent = isSelected || (selected === undefined && isBest);
                return (
                  <div
                    key={`${slot.start}-${slot.end}`}
                    className="absolute top-0 bottom-0"
                    style={{
                      left: `${box.left}%`,
                      // A 45-minute slot across two days is a sliver; give it a
                      // floor so the answer is never too thin to see.
                      width: `max(3px, ${box.width}%)`,
                      background: 'var(--band-overlap)',
                      opacity: prominent ? 1 : 0.4,
                    }}
                  />
                );
              })}
            </div>

            {/* Scrub surface + focus line, overlaid on every row at once so
                dragging anywhere in the band area moves the shared clock. */}
            <div
              ref={trackRef}
              role="slider"
              aria-label="Scrub the shared timeline"
              aria-valuemin={window.from}
              aria-valuemax={window.to}
              aria-valuenow={focusInstant}
              aria-valuetext={DateTime.fromMillis(focusInstant, { zone: viewerZone }).toFormat(
                "ccc d LLL, HH:mm",
              )}
              tabIndex={0}
              className="absolute inset-x-0 bottom-0 cursor-ew-resize touch-none"
              style={{ top: TICK_ROW_HEIGHT }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onKeyDown={onKeyDown}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 bottom-0 w-px bg-(--signal)"
                style={{ left: `${focusPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GutterCell({
  member,
  viewerZone,
  focusInstant,
}: {
  member: Member;
  viewerZone: string;
  focusInstant: number;
}) {
  const local = DateTime.fromMillis(focusInstant, { zone: member.timezone });
  // `offsetNameShort` gives "EST"/"GMT+5:30"-style abbreviations without
  // hand-maintaining a zone → abbreviation table, and updates correctly
  // across a DST boundary because it's read from the zoned instant itself.
  const abbrev = local.offsetNameShort ?? member.timezone;

  return (
    <div className="flex items-center gap-2 pr-3" style={{ height: ROW_HEIGHT }}>
      <MemberTag name={member.name} tag={member.tag} color={member.color} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm text-(--ink)">{member.name}</div>
        <Meta as="div" className="truncate">
          {abbrev} · {local.toFormat('HH:mm')}
        </Meta>
      </div>
    </div>
  );
}

function MemberRow({ bands, window }: { bands: MemberBands | undefined; window: Window }) {
  // Stacking order, bottom to top: free (the base fill) → off-hours → busy
  // → asleep. Asleep is drawn last because it is the one HARD fact among
  // the three — if a stray calendar event were ever recorded during a
  // sleep window, the row must still read as "asleep," not "busy."
  const offHours = bands?.offHours.map((iv) => clipToWindow(iv, window)).filter(isRect) ?? [];
  const busy = bands?.busy.map((iv) => clipToWindow(iv, window)).filter(isRect) ?? [];
  const asleep = bands?.asleep.map((iv) => clipToWindow(iv, window)).filter(isRect) ?? [];

  return (
    <div className="relative slit-top slit-dim" style={{ height: ROW_HEIGHT }}>
      <div className="absolute inset-0" style={{ background: 'var(--band-free)' }} />
      {offHours.map((r, i) => (
        <div
          key={`oh-${i}`}
          className="absolute inset-y-0"
          style={{ left: `${r.left}%`, width: `${r.width}%`, background: 'var(--band-off-hours)' }}
        />
      ))}
      {busy.map((r, i) => (
        <div
          key={`busy-${i}`}
          className="absolute inset-y-0"
          style={{
            left: `${r.left}%`,
            width: `${r.width}%`,
            backgroundColor: 'var(--band-busy-base)',
            // Busy is separated from off-hours by texture, not value, so the
            // encoding survives greyscale and a compressed screenshot.
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--band-busy-hatch) 0, var(--band-busy-hatch) 1px, transparent 1px, transparent var(--band-busy-hatch-pitch))',
          }}
        />
      ))}
      {asleep.map((r, i) => (
        // `slit-bottom slit-dim` paints the 1px baseline glow PLAN.md asks
        // for, so an all-night (near-black) row is still traceable rather
        // than reading as a gap in the timeline.
        <div
          key={`asleep-${i}`}
          className="slit-bottom slit-dim absolute inset-y-0"
          style={{ left: `${r.left}%`, width: `${r.width}%`, background: 'var(--band-asleep)' }}
        />
      ))}
    </div>
  );
}

function isRect(v: { left: number; width: number } | null): v is { left: number; width: number } {
  return v !== null;
}

function clampPercent(p: number): number {
  return Math.min(100, Math.max(0, p));
}

type Tick = { instant: number; label: string };

/**
 * Hour ticks in the viewer's zone, spaced wider as the window grows so the
 * axis doesn't turn into an unreadable comb on a multi-day horizon. A tick
 * landing on local midnight is labelled with the date instead of the time —
 * that's the "day tick" PLAN.md asks for, distinguished by content rather
 * than a second visual language.
 *
 * Stepping is done by adding zoned Luxon durations (not raw milliseconds),
 * so the tick grid itself shifts correctly across a DST boundary in the
 * viewer's own zone instead of drifting by an hour for the rest of the axis.
 */
function buildTicks(window: Window, zone: string): Tick[] {
  const spanHours = (window.to - window.from) / 3_600_000;
  const stepHours = spanHours > 72 ? 12 : spanHours > 30 ? 6 : 3;

  const ticks: Tick[] = [];
  let cursor = DateTime.fromMillis(window.from, { zone }).startOf('hour');
  if (cursor.toMillis() < window.from) cursor = cursor.plus({ hours: 1 });

  // Bounded defensively: a pathological zone/step combination must not spin
  // forever. 500 ticks covers a multi-week horizon at the tightest 3h step
  // with room to spare.
  let guard = 0;
  while (cursor.toMillis() < window.to && guard < 500) {
    const instant = cursor.toMillis();
    const label = cursor.hour === 0 ? cursor.toFormat('ccc d') : cursor.toFormat('HH:mm');
    ticks.push({ instant, label });
    cursor = cursor.plus({ hours: stepHours });
    guard += 1;
  }
  return ticks;
}
