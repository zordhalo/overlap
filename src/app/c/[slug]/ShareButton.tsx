'use client';

import { useState } from 'react';
import { GhostButton } from '@/components/ui';

/**
 * Copies the current page URL. Built from `window.location` at click time
 * rather than passed a prop from the server, so it's always exactly the URL
 * the visitor is looking at (including any future query params) without the
 * server needing to know its own origin.
 */
export function ShareButton() {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be denied (permissions, non-secure context). The
      // link is still visible in the address bar, so this degrades to
      // "nothing happened" rather than a broken page.
    }
  };

  return <GhostButton onClick={handleClick}>{copied ? 'Copied' : 'Copy link'}</GhostButton>;
}
