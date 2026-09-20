import Link from 'next/link';
import { GhostButton, Meta } from '@/components/ui';

/** Reached when a slug resolves to nothing — a mistyped link, an expired
 *  demo circle, or someone guessing. Since `slug` is a capability URL (see
 *  PLAN.md §5), there is deliberately no lookup or search offered here: a
 *  "browse circles" link would be the enumeration surface the slug design
 *  exists to avoid. */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-4 px-6 py-16">
      <Meta as="div">404</Meta>
      <h1 className="text-(length:--text-heading) leading-(--text-heading--line-height) tracking-(--text-heading--letter-spacing) text-(--ink)">
        No circle here.
      </h1>
      <p className="text-(length:--text-body) text-(--muted)">
        This link doesn&apos;t match a circle we know about. Check it was copied in full, or ask
        whoever shared it to send it again.
      </p>
      <Link href="/">
        <GhostButton>Start a new circle</GhostButton>
      </Link>
    </main>
  );
}
