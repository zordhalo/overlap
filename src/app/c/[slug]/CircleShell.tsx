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

import { useState } from 'react';
import { ClockProvider, useClock } from '@/lib/time/clock';
import { Globe } from '@/components/globe';
import { Timeline } from '@/components/timeline';
import { Slots } from '@/components/slots';
import type { MemberBands, Window } from '@/components/bands';
import type { Member, Slot, SuggestResult } from '@/lib/schedule/types';

type CircleShellProps = {
  slug: string;
  members: Member[];
  bands: MemberBands[];
  timelineWindow: Window;
  result: SuggestResult;
  now: number;
};

export function CircleShell({ slug, members, bands, timelineWindow, result, now }: CircleShellProps) {
  return (
    <ClockProvider initialInstant={now}>
      <CircleContent slug={slug} members={members} bands={bands} timelineWindow={timelineWindow} result={result} />
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
}: Omit<CircleShellProps, 'now'>) {
  const { focus } = useClock();
  const [selected, setSelected] = useState<Slot | undefined>(undefined);

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
  };

  return (
    <div
      className="grid grid-cols-1 gap-10
        lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_auto]
        lg:[grid-template-areas:'slots_globe'_'timeline_globe']"
    >
      <div className="lg:[grid-area:slots]">
        <Slots result={result} members={members} onPick={handlePick} selected={selected} />
      </div>
      <div className="lg:[grid-area:timeline]">
        <Timeline members={members} bands={bands} window={timelineWindow} />
      </div>
      <div className="lg:[grid-area:globe]">
        <Globe members={members} />
      </div>
    </div>
  );
}
