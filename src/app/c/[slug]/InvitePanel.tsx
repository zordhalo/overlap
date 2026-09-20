'use client';

/**
 * The share step.
 *
 * A circle with one member is not a scheduling problem yet, it is an invitation
 * problem — so the page leads with the link rather than with an empty list of
 * suggestions. The previous empty state was a line of prose and a ghost button,
 * which said what had not happened without making the next action obvious.
 *
 * The link is shown as selectable text, not hidden behind a button. Copy fails
 * silently in more situations than people expect (insecure contexts, denied
 * clipboard permission, some in-app browsers), and a URL you can read and
 * select by hand always works.
 */

import { useEffect, useRef, useState } from 'react';

export function InvitePanel({
  slug,
  memberCount,
  youAreIn,
}: {
  slug: string;
  memberCount: number;
  /** Whether this browser belongs to a member, which changes what to ask for. */
  youAreIn: boolean;
}) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Built on the client so the link always matches the host the visitor is
  // actually on — the app answers on more than one domain, and a hardcoded or
  // server-guessed origin would hand someone a link to the wrong one.
  useEffect(() => {
    setUrl(`${window.location.origin}/c/${slug}`);
  }, [slug]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied or unavailable: select the text so the manual path
      // is one keystroke away rather than leaving the click doing nothing.
      inputRef.current?.select();
    }
  }

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl p-6"
      style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
    >
      <div className="flex flex-col gap-2">
        <span className="meta" style={{ color: 'var(--ok)' }}>
          {youAreIn ? "You're in" : 'Circle ready'}
        </span>
        <h2 className="text-(length:--text-heading-sm) text-(--ink)">
          {memberCount <= 1 ? 'Now send this to your people' : 'Invite anyone else'}
        </h2>
        <p className="max-w-prose text-sm text-(--muted)">
          {memberCount <= 1
            ? 'They open it, say who they are and when they sleep, and times appear here for everyone. No account, no invite email.'
            : 'Anyone with this link can add themselves to the circle.'}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label="Link to this circle"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm text-(--ink) tabular-nums"
          style={{ background: 'var(--paper)', border: '1px solid var(--edge)' }}
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-full px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          style={{ background: copied ? 'var(--ok)' : 'var(--signal)', color: 'var(--paper)' }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      {/* Said at the moment it matters, not buried in a FAQ. This link is the
          only way back in: there is no account to sign into and no email to
          recover from, so somebody who closes the tab without copying it has
          lost the circle. The browser remembers it, which covers the common
          case, but not a different device or a cleared profile. */}
      <p className="text-sm text-(--muted)">
        <span style={{ color: 'var(--cost)' }}>Keep this link.</span> It is the only way back
        into the circle — there is no account to sign into. This browser will remember it, but
        another device will not.
      </p>

      {/* Announced rather than only shown, so the confirmation is not
          invisible to anyone using a screen reader. */}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
    </section>
  );
}
