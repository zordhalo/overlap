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

/** What a returning member already saved, so the form is an edit, not a
 *  second sign-up. Minutes-from-midnight, as stored. */
export type ExistingMember = {
  name: string;
  timezone: string;
  sleepStart: number;
  sleepEnd: number;
  workStart: number;
  workEnd: number;
  hasCalendar: boolean;
  /** Whether an address is already saved. The address itself is never sent
   *  to the client: it is PII the rest of the circle has no business seeing. */
  hasEmail?: boolean;
};

/** Stored minutes-from-midnight back to the "HH:MM" an <input type=time> wants. */
function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function JoinForm({
  circleSlug,
  zoneGroups,
  existing,
}: {
  circleSlug: string;
  zoneGroups: GroupedZones;
  existing?: ExistingMember | undefined;
}) {
  // Computed once via useState's lazy initializer, not a render-time call —
  // avoids recomputing (and re-diffing the <select>) on every re-render.
  // A returning member's saved zone wins over browser detection: they may
  // have deliberately set something other than where their browser is.
  const [defaultZone] = useState(() => existing?.timezone ?? detectTimezone());
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
        <Field
          id="name"
          name="name"
          label="Your name"
          type="text"
          required
          maxLength={100}
          defaultValue={existing?.name}
        />

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
              defaultValue={existing ? toHHMM(existing.sleepStart) : DEFAULT_SLEEP_START}
            />
            <Field
              id="sleepEnd"
              name="sleepEnd"
              label="Awake by"
              type="time"
              required
              defaultValue={existing ? toHHMM(existing.sleepEnd) : DEFAULT_SLEEP_END}
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
              defaultValue={existing ? toHHMM(existing.workStart) : DEFAULT_WORK_START}
            />
            <Field
              id="workEnd"
              name="workEnd"
              label="End"
              type="time"
              required
              defaultValue={existing ? toHHMM(existing.workEnd) : DEFAULT_WORK_END}
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

      {/* Recovery address. Optional, and the copy has to make that real:
          the product's promise is that there is no account, and an email field
          that feels compulsory quietly breaks it. It is offered here because
          this is the only moment we know who the person is, and because a
          circle link with nothing behind it is unrecoverable once lost. */}
      <SlitFrame className="flex flex-col gap-3 p-6">
        <div className="flex flex-col gap-1">
          <span className="meta">Email (optional)</span>
          <p className="text-sm text-(--muted)">
            Only so you can get your circle links back if you lose them. A circle link is the
            only way in, and there is no account or password behind it. Not used for anything
            else, and never shown to anyone in the circle.
          </p>
        </div>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={existing?.hasEmail ? 'An address is saved — type to replace it' : 'you@example.com'}
          className="slit-input rounded-md px-3 py-2 text-(--ink)"
        />
        {existing?.hasEmail ? (
          <span className="meta text-(--muted)">
            Leave blank to keep the address already saved.
          </span>
        ) : null}
      </SlitFrame>

      <div>
        <Pill type="submit">{existing ? 'Save changes' : 'Join circle'}</Pill>
      </div>
    </form>
  );
}
