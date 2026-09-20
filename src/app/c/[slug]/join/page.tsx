import { notFound } from 'next/navigation';
import { getCircleBySlug } from '@/lib/db/queries';
import { groupedZones } from '@/lib/zones';
import { JoinForm } from './JoinForm';

/**
 * The cold-open flow: someone arrives from a shared link with zero context
 * and has to succeed with no guidance. Everything that needs the visitor's
 * browser (defaulting the timezone) lives in `JoinForm`, a client component;
 * this stays a server component so an unknown slug 404s before any client
 * JS ships.
 */
export default async function JoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const circle = await getCircleBySlug(slug);
  if (!circle) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-2">
        <span className="meta">{circle.name}</span>
        <h1 className="text-(length:--text-heading) leading-(--text-heading--line-height) tracking-(--text-heading--letter-spacing) text-(--ink)">
          Join this circle
        </h1>
        <p className="text-(length:--text-body) text-(--muted)">
          Set yourself up once. You can come back and change any of this later from the same
          browser.
        </p>
      </div>
      <JoinForm circleSlug={slug} zoneGroups={groupedZones()} />
    </main>
  );
}
