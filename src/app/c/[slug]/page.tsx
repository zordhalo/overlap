import Link from 'next/link';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import {
  getCircleBySlug,
  getMemberIcsUrl,
  isBusyStale,
  syncMemberBusy,
  toScheduleMembers,
} from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/session';
import { offHoursIntervals, sleepIntervals, suggest } from '@/lib/schedule';
import type { Member } from '@/lib/schedule/types';
import type { MemberBands, Window } from '@/components/bands';
import { GhostButton, Meta } from '@/components/ui';
import { fetchIcsIntervals } from '@/lib/ics';
import { CircleShell } from './CircleShell';
import { ShareButton } from './ShareButton';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The timeline visualizes a shorter, denser window than the full search
 *  horizon — a circle's `horizonDays` can be up to a year, and drawing that
 *  many days of bands would be unreadable. Ranked slots (via `suggest`)
 *  still search the full horizon; only the visual strip is narrowed. */
const TIMELINE_WINDOW_DAYS = 3;

/**
 * Builds one `MemberBands` per member from the frozen engine's own interval
 * generators, over the timeline's display window (not the full search
 * horizon — see `TIMELINE_WINDOW_DAYS`). This glue is owned here rather
 * than by the timeline component itself: `bands.ts`'s header is explicit
 * that computing `MemberBands` from real engine output is the pages agent's
 * job, precisely so the timeline stays independent of the engine's shape.
 */
function computeBands(members: Member[], window: Window): MemberBands[] {
  return members.map((member) => ({
    memberId: member.id,
    asleep: sleepIntervals(member, window.from, window.to),
    offHours: offHoursIntervals(member, window.from, window.to),
    // Not clipped to `window` here — clipToWindow (bands.ts) handles that at
    // render time, same as the other two bands would need to be if they
    // extended past the edges.
    busy: member.busy,
  }));
}

/**
 * Refresh stale calendars AFTER the response is sent.
 *
 * Awaiting this inline would add up to the 8s fetch timeout to the page load,
 * per stale member, on a page whose whole promise is that it already knows the
 * answer. `after()` runs the work once the response has been streamed, so the
 * visitor waits for nothing and the next load sees fresh data.
 *
 * Deliberately best-effort: every failure is swallowed here rather than
 * surfaced, because `syncMemberBusy` already guarantees the important
 * property — a failed or timed-out fetch leaves the previous busy rows
 * untouched instead of clearing them. Losing busy data would silently turn
 * "busy" into "free", which is the worst direction for a scheduler to fail in.
 * A stale calendar is a much smaller problem than a wrong one.
 */
function scheduleCalendarRefresh(members: { id: string; hasCalendar: boolean }[], window: { from: number; to: number }): void {
  const withCalendars = members.filter((m) => m.hasCalendar);
  if (withCalendars.length === 0) return;

  after(async () => {
    await Promise.allSettled(
      withCalendars.map(async (m) => {
        if (!(await isBusyStale(m.id))) return;
        const url = await getMemberIcsUrl(m.id);
        if (!url) return;
        await syncMemberBusy(
          m.id,
          (signal) => fetchIcsIntervals(url, { from: window.from, to: window.to, signal }),
          'ics',
        );
      }),
    );
  });
}

export default async function CirclePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  const members = toScheduleMembers(circle);
  const now = Date.now();

  // The ranked answer is computed server-side so first paint already shows
  // it — no client round trip before the page can say "here's when."
  const result = suggest(members, {
    durationMinutes: circle.durationMinutes,
    horizonDays: circle.horizonDays,
    from: now,
  });

  const timelineWindow: Window = { from: now, to: now + TIMELINE_WINDOW_DAYS * DAY_MS };
  const bands = computeBands(members, timelineWindow);

  // Fire-and-forget; see scheduleCalendarRefresh. Uses the full search
  // horizon, not the narrower visual window, so the cache covers everything
  // suggest() will look at.
  scheduleCalendarRefresh(circle.members, {
    from: now,
    to: now + circle.horizonDays * DAY_MS,
  });

  const sessionMemberId = await getSessionMemberId(slug);
  const currentMember = members.find((m) => m.id === sessionMemberId);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Meta as="div">Circle</Meta>
          <h1 className="text-(length:--text-heading-lg) leading-(--text-heading-lg--line-height) tracking-(--text-heading-lg--letter-spacing) text-(--ink)">
            {circle.name}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {currentMember ? (
            <Meta as="span">This is you — {currentMember.name}</Meta>
          ) : (
            <Link href={`/c/${slug}/join`}>
              <GhostButton>Join this circle</GhostButton>
            </Link>
          )}
          <ShareButton />
        </div>
      </header>

      {members.length === 0 ? (
        // Never an empty state: say so, and point at the one next action
        // that fixes it.
        <div className="slit-frame flex flex-col gap-3 p-6">
          <Meta as="div">Nobody has joined yet</Meta>
          <p className="text-(length:--text-body) text-(--muted)">
            Share this link, or send the join page directly, and Overlap will start suggesting
            times as soon as the first person sets up their availability.
          </p>
          <div>
            <Link href={`/c/${slug}/join`}>
              <GhostButton>Join this circle</GhostButton>
            </Link>
          </div>
        </div>
      ) : (
        <CircleShell
          slug={slug}
          members={members}
          bands={bands}
          timelineWindow={timelineWindow}
          result={result}
          now={now}
        />
      )}
    </main>
  );
}
