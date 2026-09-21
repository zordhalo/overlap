'use client';

/**
 * The interactive shell for the circle page. A client component because
 * picking a slot has to drive the shared clock, and `useClock` is a hook —
 * everything upstream of this (the data fetch, the engine call, the bands
 * computation) stays server-side in `page.tsx`.
 *
 * Layout: Slots must be first in DOM order (mobile/screen readers get the
 * answer first), but desktop is free to *present* differently — done here
 * with CSS grid-template-areas rather than DOM reordering, so the visual
 * rearrangement never touches source order.
 */

import { useEffect, useState, useTransition } from 'react';
import { ClockProvider, useClock } from '@/lib/time/clock';
import { Globe } from '@/components/globe';
import { Timeline } from '@/components/timeline';
import { Slots } from '@/components/slots';
import { Pill } from '@/components/ui';
import type { MemberBands, Window } from '@/components/bands';
import type { Member, Slot, SuggestResult } from '@/lib/schedule/types';
import { googleTemplateUrl } from '@/lib/google/template';
import {
  addToGoogleCalendarAction,
  chooseSlotAction,
  clearChosenAction,
  type AddToGoogleResult,
} from '@/app/actions';

type CircleShellProps = {
  slug: string;
  circleName: string;
  members: Member[];
  bands: MemberBands[];
  timelineWindow: Window;
  result: SuggestResult;
  now: number;
  /** The circle's persisted agreement, so a visitor arriving cold sees which
   *  time was chosen rather than an unselected list. */
  agreed?: { start: number; end: number } | null;
  /** Name of whoever chose the current time, for the picker's panel. */
  agreedByName?: string | null;
  /** The signed-in member's saved zone, so "your zone" means the zone they
   *  told us rather than wherever the browser happens to be. */
  viewerZone?: string | null;
  /** Whether the person viewing has Google Calendar connected, which is what
   *  turns "download a file" into "it is already in your calendar". */
  googleConnected?: boolean;
  /** `?calendar=` from a return trip through Google, to say how it went. */
  calendarNotice?: string | null;
};

export function CircleShell({
  slug,
  circleName,
  members,
  bands,
  timelineWindow,
  result,
  now,
  viewerZone = null,
  agreed = null,
  agreedByName = null,
  googleConnected = false,
  calendarNotice = null,
}: CircleShellProps) {
  return (
    <ClockProvider initialInstant={now}>
      <CircleContent
        slug={slug}
        circleName={circleName}
        members={members}
        bands={bands}
        timelineWindow={timelineWindow}
        result={result}
        viewerZone={viewerZone}
        agreed={agreed}
        agreedByName={agreedByName}
        googleConnected={googleConnected}
        calendarNotice={calendarNotice}
      />
    </ClockProvider>
  );
}

/**
 * Triggers a same-tab file download from the `.ics` API route's response,
 * without navigating away from the circle page. `POST` (not a plain link)
 * because the slot's start/end have to be sent as a body rather than
 * encoded into a shareable URL.
 */
async function downloadIcs(slug: string, slot: Slot): Promise<void> {
  const response = await fetch('/api/ics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, start: slot.start, end: slot.end }),
  });
  if (!response.ok) return; // best-effort: the slot is still selected/focused either way
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug}.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

/** What the page says after a trip through Google's consent screen. */
const CALENDAR_NOTICES: Record<string, string> = {
  connected: 'Google Calendar connected. Your busy time counts from the next load.',
  failed: 'Google Calendar did not connect. Try again.',
  'no-refresh-token': 'Google Calendar did not connect. Try again.',
  added: 'Added to your Google Calendar.',
  'add-declined': 'Not added: Google was not given permission to add events. The .ics download still works.',
  'add-failed': 'Could not add it to Google Calendar. The .ics download still works.',
};

/** The Google add, per slot, so a state never leaks onto a different time. */
type GoogleAdd =
  | { key: string; status: 'adding' | 'redirecting' | 'failed' }
  | { key: string; status: 'added'; htmlLink: string | null }
  | { key: string; status: 'needs-permission'; url: string };

const slotKey = (slot: { start: number; end: number }) => `${slot.start}-${slot.end}`;

function CircleContent({
  slug,
  circleName,
  members,
  bands,
  timelineWindow,
  result,
  viewerZone,
  agreed,
  agreedByName,
  googleConnected,
  calendarNotice,
}: Omit<CircleShellProps, 'now'>) {
  const { focus } = useClock();
  // Seeded from the stored agreement, so the list shows the chosen time to
  // everyone who opens the link — not only to whoever clicked it this session.
  const [selected, setSelected] = useState<Slot | undefined>(() =>
    agreed && result.kind === 'slots'
      ? result.slots.find((s) => s.start === agreed.start && s.end === agreed.end)
      : undefined,
  );
  const [pending, startTransition] = useTransition();
  // Distinguishes "you just did this" from "this was already agreed". Without
  // it the page announced "Saved for everyone" to someone who had merely
  // opened the link and chosen nothing.
  const [justActed, setJustActed] = useState(false);

  // Arriving back from Google with the event already written: show the agreed
  // time as added rather than offering the button that just did it.
  const [googleAdd, setGoogleAdd] = useState<GoogleAdd | null>(() =>
    calendarNotice === 'added' && agreed
      ? { key: slotKey(agreed), status: 'added', htmlLink: null }
      : null,
  );
  const [notice, setNotice] = useState<string | null>(
    calendarNotice ? (CALENDAR_NOTICES[calendarNotice] ?? null) : null,
  );

  // Resolved after mount: this panel also renders on the server whenever a
  // time is already agreed, where there is no `window` to ask.
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // The notice is one-shot. Left in the URL, a reload (or a copied link) would
  // announce "Added to your Google Calendar" again to someone who did nothing.
  useEffect(() => {
    if (!calendarNotice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('calendar');
    window.history.replaceState(null, '', url.toString());
  }, [calendarNotice]);

  /**
   * One click, straight into the member's own calendar. `interactive` is false
   * when this runs as a side effect of picking a time: a pick must never send
   * someone off to a Google consent screen they did not ask for, so a missing
   * grant is surfaced as a button instead of a redirect.
   */
  const addToGoogle = async (slot: Slot, interactive: boolean) => {
    const key = slotKey(slot);
    setNotice(null);
    setGoogleAdd({ key, status: 'adding' });
    let outcome: AddToGoogleResult;
    try {
      outcome = await addToGoogleCalendarAction(slug, slot.start, slot.end);
    } catch {
      outcome = { status: 'failed' };
    }
    switch (outcome.status) {
      case 'added':
      case 'already':
        setGoogleAdd({ key, status: 'added', htmlLink: outcome.htmlLink });
        return;
      case 'needs-permission':
        if (interactive) {
          setGoogleAdd({ key, status: 'redirecting' });
          window.location.assign(outcome.url);
        } else {
          setGoogleAdd({ key, status: 'needs-permission', url: outcome.url });
        }
        return;
      default:
        setGoogleAdd({ key, status: 'failed' });
    }
  };

  // Reopening the question is the inverse of picking, and belongs beside it
  // rather than in a separate banner: one panel owns the decision.
  const handleClear = () => {
    setJustActed(false);
    setSelected(undefined);
    setGoogleAdd(null);
    setNotice(null);
    startTransition(() => {
      void clearChosenAction(slug);
    });
  };

  // Picking a slot is the moment the globe earns its place (PLAN.md §6):
  // it sets the shared clock's focus, which rotates the terminator to show
  // who is in daylight and who isn't at that time. It also gets the meeting
  // into the picker's own calendar: written straight to Google when they have
  // it connected and have allowed it, otherwise handed over as an .ics file.
  const handlePick = (slot: Slot) => {
    setJustActed(true);
    setSelected(slot);
    setNotice(null);
    focus(slot.start);
    if (googleConnected) void addToGoogle(slot, false);
    else void downloadIcs(slug, slot);
    // Record it for the whole circle, not just this browser. Before this, the
    // only trace of a decision was a file in one person's downloads folder, so
    // the group still had to agree again somewhere else. It also supplies the
    // confirmation the click previously lacked: the agreed banner appears.
    startTransition(() => {
      void chooseSlotAction(slug, slot.start, slot.end);
    });
  };

  const calendarActions = (slot: Slot) => {
    const icsHref = `/api/ics?slug=${encodeURIComponent(slug)}&start=${slot.start}&end=${slot.end}`;
    const state = googleAdd?.key === slotKey(slot) ? googleAdd : null;
    const linkClass = 'meta underline underline-offset-4 hover:text-(--ink)';

    if (!googleConnected) {
      // No grant, so no direct write. Google's own prefilled event page is the
      // next best thing: nothing downloads, and it is one click to save.
      const templateHref = googleTemplateUrl({
        start: slot.start,
        end: slot.end,
        summary: circleName,
        description: 'Scheduled with Overlap.',
        url: `${origin}/c/${slug}`,
      });
      return (
        <>
          <Pill onClick={() => void downloadIcs(slug, slot)}>Add to calendar</Pill>
          <a href={templateHref} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Open in Google Calendar
          </a>
        </>
      );
    }

    if (state?.status === 'added') {
      return (
        <>
          <span className="meta" style={{ color: 'var(--ok)' }}>
            In your Google Calendar
          </span>
          {state.htmlLink ? (
            <a href={state.htmlLink} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Open it
            </a>
          ) : null}
        </>
      );
    }

    const busy = state?.status === 'adding' || state?.status === 'redirecting';
    return (
      <>
        <Pill
          disabled={busy}
          onClick={() => {
            // Already known to need the grant: go straight there rather than
            // asking the server a question it has just answered.
            if (state?.status === 'needs-permission') {
              setGoogleAdd({ key: state.key, status: 'redirecting' });
              window.location.assign(state.url);
            } else void addToGoogle(slot, true);
          }}
        >
          {state?.status === 'adding'
            ? 'Adding…'
            : state?.status === 'redirecting'
              ? 'Opening Google…'
              : 'Add to Google Calendar'}
        </Pill>
        <a href={icsHref} className={linkClass}>
          Download .ics
        </a>
      </>
    );
  };

  const addState = selected && googleAdd?.key === slotKey(selected) ? googleAdd.status : null;
  const status = pending
    ? 'Saving this time for the circle…'
    : notice
      ? notice
      : justActed && selected
        ? !googleConnected
          ? 'Saved for everyone, and downloaded to your calendar.'
          : addState === 'added'
            ? 'Saved for everyone, and added to your Google Calendar.'
            : addState === 'needs-permission'
              ? 'Saved for everyone. Allow Overlap to add it to your Google Calendar below.'
              : addState === 'failed'
                ? 'Saved for everyone. Could not reach Google Calendar; the .ics download still works.'
                : 'Saved for everyone.'
        : addState === 'failed'
          ? 'Could not reach Google Calendar. The .ics download still works.'
          : ' ';

  return (
    <div
      className="grid grid-cols-1 gap-10
        lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_auto]
        lg:[grid-template-areas:'slots_globe'_'timeline_timeline']"
    >
      <div className="flex flex-col gap-3 lg:[grid-area:slots]">
        <Slots
          result={result}
          members={members}
          onPick={handlePick}
          selected={selected}
          viewerZone={viewerZone}
          agreedByName={agreedByName}
          onClear={handleClear}
          calendarActions={calendarActions}
        />
        {/* Clicking previously did nothing visible while the .ics downloaded
            in the background, so it read as broken and invited a second click. */}
        <p aria-live="polite" className="meta normal-case tracking-normal text-(--muted)">
          {status}
        </p>
      </div>
      <div className="lg:[grid-area:timeline]">
        <Timeline
          members={members}
          bands={bands}
          window={timelineWindow}
          slots={result.kind === 'slots' ? result.slots : []}
          selected={selected}
          viewerZone={viewerZone}
        />
      </div>
      <div className="lg:[grid-area:globe]">
        <Globe members={members} viewerZone={viewerZone} />
      </div>
    </div>
  );
}
