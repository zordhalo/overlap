import { Meta, Pill, SlitFrame } from '@/components/ui';
import { createCircleAction } from './actions';
import { DemoShowcase } from './DemoShowcase';
import { demoMembers } from './demo-data';
import { offHoursIntervals, sleepIntervals, suggest } from '@/lib/schedule';
import type { MemberBands, Window } from '@/components/bands';
import type { Member } from '@/lib/schedule/types';

/**
 * Regenerate hourly. The demo is computed from "now", so a page prerendered
 * once at build time would keep showing the build day's dates and slowly
 * become a lie. The demo is also anchored to the top of the hour, so an
 * hourly revalidation matches the only granularity it can actually change at.
 */
export const revalidate = 3600;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEMO_WINDOW_DAYS = 2;

/**
 * The landing page shows the product working before it asks for anything.
 *
 * The demo below is not a picture of Overlap — it is Overlap, with three
 * example people instead of yours. Same engine call, same components, same
 * shared clock. A static mockup would be cheaper and would start lying the
 * first time either side changed.
 */
function computeBands(members: Member[], window: Window): MemberBands[] {
  return members.map((member) => ({
    memberId: member.id,
    asleep: sleepIntervals(member, window.from, window.to),
    offHours: offHoursIntervals(member, window.from, window.to),
    busy: member.busy,
  }));
}

const HOW = [
  {
    label: 'Share one link',
    body: 'A circle has no accounts and no invites. Whoever holds the link opens it, says who they are, and they are in.',
  },
  {
    label: 'Sleep is a hard line',
    body: 'Free at 4am is not free. Sleep is never a candidate; hours outside your working day are allowed but counted as an ask.',
  },
  {
    label: 'The cost is stated',
    body: 'Every suggestion says who pays for it — an early start, a late night — so you choose knowing, instead of finding out afterwards.',
  },
];

export default function HomePage() {
  // Anchored to the hour so the server-rendered markup is stable and the demo
  // does not re-shuffle on every request.
  const now = Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
  const members = demoMembers(now);
  const timelineWindow: Window = { from: now, to: now + DEMO_WINDOW_DAYS * DAY_MS };
  const bands = computeBands(members, timelineWindow);
  const result = suggest(members, { durationMinutes: 45, horizonDays: 5, from: now, limit: 4 });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-16 px-6 py-16">
      <section className="flex max-w-3xl flex-col gap-4">
        <Meta as="div">Overlap</Meta>
        <h1 className="text-(length:--text-display) leading-(--text-display--line-height) tracking-(--text-display--letter-spacing) text-(--ink)">
          The cost was never the meeting.
        </h1>
        <p className="max-w-prose text-(length:--text-body) text-(--muted)">
          It was the negotiation about when. Share one link. Everyone lands on a page that already
          knows the answer — a globe of where your people are, and the times nobody has to lose
          sleep for.
        </p>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <Meta as="h2">A circle, running right now</Meta>
          <Meta as="p" className="normal-case tracking-normal text-(--muted)">
            Three example people. Scrub the timeline, or pick a time and watch the globe turn to it.
          </Meta>
        </div>
        <DemoShowcase
          members={members}
          bands={bands}
          timelineWindow={timelineWindow}
          result={result}
          now={now}
        />
      </section>

      <section className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {HOW.map((item) => (
          <div key={item.label} className="flex flex-col gap-2">
            <Meta as="h3">{item.label}</Meta>
            <p className="text-(length:--text-body) text-(--muted)">{item.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <SlitFrame className="flex max-w-xl flex-col gap-4 p-6">
          <form action={createCircleAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="meta">
                Circle name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                maxLength={100}
                placeholder="Co-founders"
                className="slit-input rounded-md px-3 py-2 text-(--ink)"
              />
            </div>
            <div>
              <Pill type="submit">Create a circle</Pill>
            </div>
          </form>
        </SlitFrame>

        <Meta as="p" className="max-w-prose normal-case tracking-normal text-(--muted)">
          No account. Whoever holds the link can join — set a name, a timezone, and when you sleep,
          and Overlap does the rest.
        </Meta>
      </section>

      {/* Credit where the address comes from. Overlap lives on a claimed name
          from a subdomain registry rather than on a *.vercel.app URL, and
          saying so is both honest and the reason the registry exists. */}
      <footer className="slit-top pt-6">
        <Meta as="p" className="normal-case tracking-normal text-(--muted)">
          Open source, AGPL-3.0 —{' '}
          <a
            href="https://github.com/zordhalo/overlap"
            className="text-(--ink) underline underline-offset-4"
          >
            github.com/zordhalo/overlap
          </a>
          . Running on a free subdomain from{' '}
          <a href="https://runs-on.dev" className="text-(--ink) underline underline-offset-4">
            runs-on.dev
          </a>
          , a subdomain registry by{' '}
          <a
            href="https://advancelabs.dev"
            className="text-(--ink) underline underline-offset-4"
          >
            Advance Labs
          </a>
          .
        </Meta>
      </footer>
    </main>
  );
}
