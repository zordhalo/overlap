'use client';

import { useMemo, useState } from 'react';
import { Field, GhostButton, Meta, Pill, SlitFrame } from '@/components/ui';
import type { GroupedZones } from '@/lib/zones';
import { joinCircleAction } from '@/app/actions';

/** Sane defaults per PLAN.md/the brief: a typical overnight sleep window and
 *  a typical 9-to-5. Both are plain <input type="time"> values, edited in
 *  place — nobody has to already know their own numbers to submit. */
const DEFAULT_SLEEP_START = '23:00';
const DEFAULT_SLEEP_END = '07:00';
const DEFAULT_WORK_START = '09:00';
const DEFAULT_WORK_END = '17:00';

/**
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is a browser API, so
 * the default has to be computed client-side. Read once, synchronously, at
 * first render — no flash of an empty select. Returned as-is even when the
 * curated `<select>` doesn't list it; `extraOption` below adds it as a
 * one-off option so a real detected zone is never silently swapped for
 * UTC. Falls back to UTC only if `Intl` itself throws.
 */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function JoinForm({
  circleSlug,
  zoneGroups,
}: {
  circleSlug: string;
  zoneGroups: GroupedZones;
}) {
  // Computed once via useState's lazy initializer, not a render-time call —
  // avoids recomputing (and re-diffing the <select>) on every re-render.
  const [defaultZone] = useState(() => detectTimezone());
  const [calendarOpen, setCalendarOpen] = useState(false);

  // The visitor's own zone may genuinely not be in the curated <select> list
  // (zones.ts's fallback still resolves it server-side via zoneInfo, but a
  // <select> needs a concrete <option> to select). Add it as an extra
  // option rather than silently falling back to UTC, which would be wrong
  // more often than it's right.
  const extraOption = useMemo(() => {
    const known = zoneGroups.some((g) => g.zones.some((z) => z.value === defaultZone));
    return known ? null : defaultZone;
  }, [zoneGroups, defaultZone]);

  const boundAction = joinCircleAction.bind(null, circleSlug);

  return (
    <form action={boundAction} className="flex flex-col gap-8">
      <SlitFrame className="flex flex-col gap-4 p-6">
        <Field id="name" name="name" label="Your name" type="text" required maxLength={100} />

        <div className="flex flex-col gap-2">
          <label htmlFor="timezone" className="meta">
            Timezone
          </label>
          <select
            id="timezone"
            name="timezone"
            required
            defaultValue={defaultZone}
            className="slit-input rounded-md px-3 py-2 text-(--ink)"
          >
            {extraOption && (
              <option value={extraOption}>{extraOption} (detected)</option>
            )}
            {zoneGroups.map((group) => (
              <optgroup key={group.region} label={group.region}>
                {group.zones.map((z) => (
                  <option key={z.value} value={z.value}>
                    {z.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Meta as="p" className="normal-case tracking-normal">
            Detected from your browser. Change it if you&apos;re somewhere temporary.
          </Meta>
        </div>
      </SlitFrame>

      <SlitFrame className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <Meta as="div">When you sleep</Meta>
          <p className="text-sm text-(--muted)">
            So nothing lands at 4am. This is the window Overlap will never suggest a meeting in.
          </p>
          <div className="flex gap-4">
            <Field
              id="sleepStart"
              name="sleepStart"
              label="Asleep by"
              type="time"
              required
              defaultValue={DEFAULT_SLEEP_START}
            />
            <Field
              id="sleepEnd"
              name="sleepEnd"
              label="Awake by"
              type="time"
              required
              defaultValue={DEFAULT_SLEEP_END}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Meta as="div">Working hours</Meta>
          <p className="text-sm text-(--muted)">
            So a suggestion outside these hours is flagged as an ask, not treated as free.
          </p>
          <div className="flex gap-4">
            <Field
              id="workStart"
              name="workStart"
              label="Start"
              type="time"
              required
              defaultValue={DEFAULT_WORK_START}
            />
            <Field
              id="workEnd"
              name="workEnd"
              label="End"
              type="time"
              required
              defaultValue={DEFAULT_WORK_END}
            />
          </div>
        </div>
      </SlitFrame>

      <SlitFrame className="flex flex-col gap-3 p-6">
        <div className="flex items-baseline justify-between gap-3">
          <Meta as="div">Calendar (optional)</Meta>
          {!calendarOpen && (
            <GhostButton type="button" onClick={() => setCalendarOpen(true)}>
              Add a calendar
            </GhostButton>
          )}
        </div>
        <p className="text-sm text-(--muted)">
          Overlap works fine without this — it just won&apos;t know about meetings already on your
          calendar. Add it any time.
        </p>
        {calendarOpen && (
          <div className="flex flex-col gap-3 pt-2">
            <Field
              id="icsUrl"
              name="icsUrl"
              label="Secret iCal URL"
              type="url"
              placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
            />
            <Meta as="p" className="flex flex-col gap-1 normal-case tracking-normal">
              <span>
                This URL is a secret — anyone who has it can read your whole calendar. We store it
                encrypted and never show it to other circle members.
              </span>
              <span>Google: Settings → Settings for my calendars → Secret address in iCal format.</span>
              <span>Outlook: Settings → Calendar → Shared calendars → Publish.</span>
              <span>Apple iCloud: Calendar → share a calendar publicly.</span>
            </Meta>
          </div>
        )}
      </SlitFrame>

      <div>
        <Pill type="submit">Join circle</Pill>
      </div>
    </form>
  );
}
