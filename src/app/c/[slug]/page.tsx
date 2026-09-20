import Link from 'next/link';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import {
  getCircleBySlug,
  getGoogleRefreshToken,
  getMemberIcsUrl,
  isBusyStale,
  syncMemberBusy,
  toScheduleMembers,
} from '@/lib/db/queries';
import { getSessionMemberId } from '@/lib/session';
import { offHoursIntervals, sleepIntervals, suggest } from '@/lib/schedule';
import type { Member } from '@/lib/schedule/types';
import type { MemberBands, Window } from '@/components/bands';
import { GhostButton, Meta, MemberTag, Pill } from '@/components/ui';
import { fetchIcsIntervals } from '@/lib/ics';
import { fetchGoogleBusy, isGoogleConfigured } from '@/lib/google';
import { clearChosenAction, switchMemberAction } from '@/app/actions';
import { CircleShell } from './CircleShell';
import { ShareButton } from './ShareButton';
import { InvitePanel } from './InvitePanel';

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
function scheduleCalendarRefresh(
  members: { id: string; hasCalendar: boolean }[],
  window: { from: number; to: number },
): void {
  const withCalendars = members.filter((m) => m.hasCalendar);
  if (withCalendars.length === 0) return;

  after(async () => {
    await Promise.allSettled(
      withCalendars.map(async (m) => {
        if (!(await isBusyStale(m.id))) return;

        // Google first when connected: freeBusy returns busy intervals and
        // nothing else, so it is both the better data and the narrower grant.
        // A pasted iCal URL stays as the fallback, which is what keeps this
        // working for anyone whose Workspace admin has disabled OAuth apps.
        const refreshToken = await getGoogleRefreshToken(m.id);
        if (refreshToken) {
          await syncMemberBusy(
            m.id,
            (signal) => fetchGoogleBusy(refreshToken, { from: window.from, to: window.to, signal }),
            'google',
          );
          return;
        }

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

/** One member's setup, shown while a circle is still waiting for others. */
function MemberSummary({ member }: { member: Member }) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: member.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(Date.now());
  return (
    <div className="flex flex-wrap items-center gap-3">
      <MemberTag name={member.name} tag={member.tag} color={member.color} />
      <span className="text-sm text-(--ink)">{member.name}</span>
      <span className="meta text-(--muted)">
        {member.timezone} · {time} now
      </span>
    </div>
  );
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
  // The connection state lives on the db record, not on the frozen scheduling
  // `Member` — which has no calendar fields on purpose, so a credential can
  // never ride along into the engine or a client prop.
  const currentRecord = circle.members.find((m) => m.id === sessionMemberId);
  const chosenByName = circle.chosen?.byMemberId
    ? (members.find((m) => m.id === circle.chosen?.byMemberId)?.name ?? null)
    : null;

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
            <div className="flex items-center gap-3">
              <Meta as="span">This is you — {currentMember.name}</Meta>
              {/* Only shown where the deployment actually has Google
                  credentials: offering a button that 501s would be worse than
                  not offering it. */}
              {isGoogleConfigured() && currentRecord?.calendarSource !== 'google' ? (
                <a
                  href={`/api/google/start?slug=${encodeURIComponent(slug)}`}
                  className="meta underline underline-offset-4 hover:text-(--ink)"
                >
                  Connect Google Calendar
                </a>
              ) : null}
              {currentRecord?.calendarSource === 'google' ? (
                <Meta as="span" style={{ color: 'var(--pulse)' }}>
                  Google Calendar connected
                </Meta>
              ) : null}
              {/* Without this there is no way out of an identity this browser
                  already holds. The first thing anyone does before sending a
                  link to three colleagues is add those three themselves to see
                  what it will look like — and they were stuck at one member,
                  because the cookie is httpOnly and cannot be cleared from
                  devtools. */}
              <form action={switchMemberAction.bind(null, slug)}>
                <button type="submit" className="meta underline underline-offset-4 hover:text-(--ink)">
                  Not you?
                </button>
              </form>
            </div>
          ) : (
            <Link href={`/c/${slug}/join`}>
              <Pill>Add yourself</Pill>
            </Link>
          )}
          {/* Sharing only appears here once the circle is past the stage where
              the invite panel below is leading with it — two copy-link controls
              on one screen is the same ambiguity the slot list used to have. */}
          {members.length > 1 ? <ShareButton /> : null}
        </div>
      </header>


      {members.length === 0 ? (
        // Nobody at all, including the visitor. One action, stated plainly.
        <section
          className="flex flex-col items-start gap-4 rounded-2xl p-6"
          style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
        >
          <Meta as="div">Empty circle</Meta>
          <h2 className="text-(length:--text-heading-sm) text-(--ink)">
            Set yourself up to start
          </h2>
          <p className="max-w-prose text-sm text-(--muted)">
            Add your timezone and the hours you keep. Then share the link, and times appear here
            as soon as somebody else does the same.
          </p>
          <Link href={`/c/${slug}/join`}>
            <Pill>Set yourself up</Pill>
          </Link>
        </section>
      ) : members.length === 1 ? (
        // One member. There is nothing to schedule yet, so the page leads with
        // the invitation rather than with an empty suggestion list — which is
        // what the old state did, and why creating a circle felt like a dead
        // end.
        <div className="flex flex-col gap-6">
          <InvitePanel slug={slug} memberCount={members.length} youAreIn={Boolean(currentMember)} />
          {!currentMember ? (
            <section
              className="flex flex-col items-start gap-3 rounded-2xl p-6"
              style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
            >
              <Meta as="div">One person so far</Meta>
              <p className="max-w-prose text-sm text-(--muted)">
                {members[0]?.name} is in. Add yourself and Overlap will start suggesting times.
              </p>
              <Link href={`/c/${slug}/join`}>
                <Pill>Add yourself</Pill>
              </Link>
            </section>
          ) : (
            <section
              className="flex flex-col gap-3 rounded-2xl p-6"
              style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
            >
              <Meta as="div">Your setup</Meta>
              <MemberSummary member={members[0]!} />
              <Link href={`/c/${slug}/join`} className="meta underline underline-offset-4">
                Change it
              </Link>
            </section>
          )}
        </div>
      ) : (
        <CircleShell
          slug={slug}
          members={members}
          bands={bands}
          timelineWindow={timelineWindow}
          result={result}
          now={now}
        viewerZone={currentMember?.timezone ?? null}
        agreed={circle.chosen}
        agreedByName={chosenByName}
        />
      )}
    </main>
  );
}
