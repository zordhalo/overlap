'use client';

/**
 * "Circles you've opened", on the landing page.
 *
 * This is the only recovery path that exists. Without it, closing the tab
 * before copying the link means the circle is gone for good: there is no
 * account, no email, and deliberately no query that lists circles.
 *
 * Rendered only after mount. Reading localStorage during render would produce
 * server markup that disagrees with the client's and trip hydration, on the
 * very component whose whole job is to be reliably present.
 */

import { useCallback, useEffect, useState } from 'react';
import { Meta } from '@/components/ui';
import {
  forgetAllCircles,
  forgetCircle,
  readRecentCircles,
  type RecentCircle,
} from '@/lib/recent-circles';

export function RecentCircles() {
  const [circles, setCircles] = useState<RecentCircle[] | null>(null);

  useEffect(() => {
    setCircles(readRecentCircles());
  }, []);

  const drop = useCallback((slug: string) => {
    forgetCircle(slug);
    setCircles(readRecentCircles());
  }, []);

  const dropAll = useCallback(() => {
    forgetAllCircles();
    setCircles([]);
  }, []);

  // `null` is "not read yet", `[]` is "read, and there are none". Only the
  // second should render nothing permanently.
  if (circles === null || circles.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Meta as="h2">Circles you have opened</Meta>
        <button
          type="button"
          onClick={dropAll}
          className="meta underline underline-offset-4 hover:text-(--ink)"
        >
          Forget all
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {circles.map((c) => (
          <li
            key={c.slug}
            className="flex items-center justify-between gap-4 rounded-xl px-4 py-3"
            style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
          >
            <a
              href={`/c/${c.slug}`}
              className="min-w-0 flex-1 truncate text-sm text-(--ink) hover:underline"
            >
              {c.name}
            </a>
            <button
              type="button"
              onClick={() => drop(c.slug)}
              aria-label={`Forget ${c.name}`}
              className="meta shrink-0 text-(--muted) hover:text-(--ink)"
            >
              Forget
            </button>
          </li>
        ))}
      </ul>

      <Meta as="p" className="normal-case tracking-normal text-(--muted)">
        Kept in this browser only, never sent anywhere. On another device, or after
        clearing this list,{' '}
        <a href="/recover" className="text-(--ink) underline underline-offset-4">
          get your links emailed to you
        </a>{' '}
        if you added an address when you joined.
      </Meta>
    </section>
  );
}
