'use client';

/**
 * The landing page's live demo.
 *
 * Same components as the real circle page, wired to the same shared clock —
 * so the globe's terminator, the timeline's focus line and the slot list all
 * move together here exactly as they do in the product. The only difference is
 * that picking a slot focuses the clock instead of downloading a calendar
 * file: on the landing page the point is to *show* what picking does, and
 * handing an anonymous visitor a .ics for a circle they are not in would be
 * confusing rather than useful.
 */

import { useState } from 'react';
import { ClockProvider, useClock } from '@/lib/time/clock';
import { Globe } from '@/components/globe';
import { Timeline } from '@/components/timeline';
import { Slots } from '@/components/slots';
import type { MemberBands, Window } from '@/components/bands';
import type { Member, Slot, SuggestResult } from '@/lib/schedule/types';

type Props = {
  members: Member[];
  bands: MemberBands[];
  timelineWindow: Window;
  result: SuggestResult;
  now: number;
  /** The signed-in member's saved zone, so "your zone" means the zone they
   *  told us rather than wherever the browser happens to be. */
  viewerZone?: string | null;
};

export function DemoShowcase({ members, bands, timelineWindow, result, now, viewerZone = null }: Props) {
  return (
    <ClockProvider initialInstant={now}>
      <DemoContent
        members={members}
        bands={bands}
        timelineWindow={timelineWindow}
        result={result}
        viewerZone={viewerZone}
      />
    </ClockProvider>
  );
}

function DemoContent({ members, bands, timelineWindow, result, viewerZone }: Omit<Props, 'now'>) {
  const { focus } = useClock();
  const [selected, setSelected] = useState<Slot | undefined>(undefined);

  const handlePick = (slot: Slot) => {
    setSelected(slot);
    focus(slot.start);
  };

  return (
    <div
      className="grid grid-cols-1 gap-8
        lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_auto]
        lg:[grid-template-areas:'slots_globe'_'timeline_timeline']"
    >
      <div className="lg:[grid-area:slots]">
        <Slots result={result} members={members} onPick={handlePick} selected={selected} />
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
