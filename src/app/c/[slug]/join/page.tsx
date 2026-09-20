import { notFound } from 'next/navigation';
import { getCircleBySlug } from '@/lib/db/queries';
import { groupedZones } from '@/lib/zones';
import { getSessionMemberId } from '@/lib/session';
import { JoinForm } from './JoinForm';
import { RememberCircle } from '@/components/RememberCircle';

/**
 * The cold-open flow: someone arrives from a shared link with zero context
 * and has to succeed with no guidance. Everything that needs the visitor's
 * browser (defaulting the timezone) lives in `JoinForm`, a client component;
 * this stays a server component so an unknown slug 404s before any client
 * JS ships.
 */
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { slug } = await params;
  // `?new=1` means we arrived straight from creating the circle. The form is
  // identical either way; only the framing changes, because "join this circle"
  // is the wrong sentence to show somebody the moment after they made it.
  const { new: isNew } = await searchParams;
  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  // Only trust the cookie after confirming it names a member of THIS circle.
  // A stale cookie then falls through to a normal join rather than prefilling
  // — or worse, editing — someone else's row.
  const sessionMemberId = await getSessionMemberId(slug);
  const mine = sessionMemberId ? circle.members.find((m) => m.id === sessionMemberId) : undefined;
  const existing = mine
    ? {
        name: mine.name,
        timezone: mine.timezone,
        sleepStart: mine.sleepStart,
        sleepEnd: mine.sleepEnd,
        workStart: mine.workStart,
        workEnd: mine.workEnd,
        hasCalendar: mine.hasCalendar,
        hasEmail: mine.hasEmail,
      }
    : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      {/* Recorded here as well as on the circle page: abandoning setup is the
          single most likely way to lose a brand-new circle. */}
      <RememberCircle slug={slug} name={circle.name} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="meta">{circle.name}</span>
          {isNew && !existing ? (
            <span className="meta" style={{ color: 'var(--ok)' }}>
              Circle created · step 2 of 2
            </span>
          ) : null}
        </div>
        <h1 className="text-(length:--text-heading) leading-(--text-heading--line-height) tracking-(--text-heading--letter-spacing) text-(--ink)">
          {existing ? 'Your setup' : isNew ? 'Now set yourself up' : 'Join this circle'}
        </h1>
        <p className="text-(length:--text-body) text-(--muted)">
          {existing
            ? 'Change anything here and save. This browser is already linked to you, so this updates you rather than adding someone new.'
            : isNew
              ? 'You are the first person in it. Set your hours and you will get a link to send the others.'
              : 'Set yourself up once. You can come back and change any of this later from the same browser.'}
        </p>
      </div>
      <JoinForm circleSlug={slug} zoneGroups={groupedZones()} existing={existing} />
    </main>
  );
}
