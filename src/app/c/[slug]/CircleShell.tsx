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

import { useState, useTransition } from 'react';
import { ClockProvider, useClock } from '@/lib/time/clock';
import { Globe } from '@/components/globe';
import { Timeline } from '@/components/timeline';
import { Slots } from '@/components/slots';
import type { MemberBands, Window } from '@/components/bands';
import type { Member, Slot, SuggestResult } from '@/lib/schedule/types';
import { chooseSlotAction } from '@/app/actions';

type CircleShellProps = {
  slug: string;
  members: Member[];
  bands: MemberBands[];
  timelineWindow: Window;
  result: SuggestResult;
  now: number;
  /** The signed-in member's saved zone, so "your zone" means the zone they
   *  told us rather than wherever the browser happens to be. */
  viewerZone?: string | null;
};

export function CircleShell({
  slug,
  members,
  bands,
  timelineWindow,
  result,
  now,
  viewerZone = null,
}: CircleShellProps) {
  return (
    <ClockProvider initialInstant={now}>
      <CircleContent
        slug={slug}
        members={members}
        bands={bands}
        timelineWindow={timelineWindow}
        result={result}
        viewerZone={viewerZone}
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

function CircleContent({
  slug,
  members,
  bands,
  timelineWindow,
  result,
  viewerZone,
}: Omit<CircleShellProps, 'now'>) {
  const { focus } = useClock();
  const [selected, setSelected] = useState<Slot | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  // Picking a slot is the moment the globe earns its place (PLAN.md §6):
  // it sets the shared clock's focus, which rotates the terminator to show
  // who is in daylight and who isn't at that time. It also downloads the
  // .ics for that slot — `Slots` doesn't distinguish its "Add to calendar"
  // and "Use this time" buttons in this callback, and choosing any slot is
  // a reasonable moment to hand over a real calendar file for it.
  const handlePick = (slot: Slot) => {
    setSelected(slot);
    focus(slot.start);
    void downloadIcs(slug, slot);
    // Record it for the whole circle, not just this browser. Before this, the
    // only trace of a decision was a file in one person's downloads folder, so
    // the group still had to agree again somewhere else. It also supplies the
    // confirmation the click previously lacked: the agreed banner appears.
    startTransition(() => {
      void chooseSlotAction(slug, slot.start, slot.end);
    });
  };

  return (
    <div
      className="grid grid-cols-1 gap-10
        lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_auto]
        lg:[grid-template-areas:'slots_globe'_'timeline_timeline']"
    >
      <div className="flex flex-col gap-3 lg:[grid-area:slots]">
        <Slots result={result} members={members} onPick={handlePick} selected={selected} />
        {/* Clicking previously did nothing visible while the .ics downloaded
            in the background, so it read as broken and invited a second click. */}
        <p aria-live="polite" className="meta normal-case tracking-normal text-(--muted)">
          {pending
            ? 'Saving this time for the circle…'
            : selected
              ? 'Saved for everyone, and downloaded to your calendar.'
              : '\u00A0'}
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
