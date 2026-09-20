import { Meta, Pill, SlitFrame } from '@/components/ui';
import { createCircleAction } from './actions';

/**
 * The pitch, in one screen, plus the one thing this page needs to do: start
 * a circle. No nav, no pricing, no second CTA — the brief's "one filled
 * white pill per screen, maximum" rule is easiest to keep by never having a
 * reason to break it here.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <div className="flex flex-col gap-4">
        <Meta as="div">Overlap</Meta>
        <h1 className="text-(length:--text-display) leading-(--text-display--line-height) tracking-(--text-display--letter-spacing) text-(--ink)">
          The cost was never the meeting.
        </h1>
        <p className="max-w-prose text-(length:--text-body) text-(--muted)">
          It was the negotiation about when. Share one link. Everyone lands on a page that already
          knows the answer — a globe of where your people are, and the times nobody has to lose
          sleep for.
        </p>
      </div>

      <SlitFrame className="flex flex-col gap-4 p-6">
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
    </main>
  );
}
