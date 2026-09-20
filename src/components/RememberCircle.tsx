'use client';

/**
 * Records a circle in this browser as soon as it is opened.
 *
 * Mounted on both the circle page and the join page, so a circle is
 * recoverable from the moment it is created — including when somebody backs
 * out of setup, which would otherwise orphan it permanently.
 */

import { useEffect } from 'react';
import { rememberCircle } from '@/lib/recent-circles';

export function RememberCircle({ slug, name }: { slug: string; name: string }) {
  useEffect(() => {
    rememberCircle(slug, name);
  }, [slug, name]);
  return null;
}
