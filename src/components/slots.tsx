'use client';

/**
 * The slot picker.
 *
 * This replaced a stack of tall cards, one per candidate, each repeating every
 * member's local time. With three members that was six lines and ~180px per
 * option, so comparing five times meant scrolling past 900 pixels of nearly
 * identical text — and because every card carried its own button, the list
 * read as several independent actions rather than one choice.
 *
 * The shape here follows the actual question. "When can we meet?" is answered
 * by a day and a time, so the options are chips grouped under their day: the
 * whole week fits in a glance, and the times cluster visibly. Everyone's local
 * time is the *detail* of one option, not something to print for all of them
 * at once, so it moves into a single panel below that describes whichever
 * option is chosen.
 *
 * This component is deliberately off the strict runs-on.dev language. That
 * system encodes identity in monochrome and reserves colour almost entirely;
 * picking a time needs colour to encode *meaning* — whether a slot costs
 * somebody an early start — and needs conventional affordances (chips, a
 * selected fill) that read as controls on sight.
 */

import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { GhostButton, Meta, MemberTag, Pill, SlitFrame } from '@/components/ui';
import type { Member, MemberCost, Slot, SuggestResult } from '@/lib/schedule/types';

type SlotsProps = {
  result: SuggestResult;
  members: Member[];
  onPick: (slot: Slot) => void;
  selected?: Slot;
  /** Zone to group days and label chips in. Null falls back to UTC. */
  viewerZone?: string | null;
  /** Who chose the current time, for the agreed panel. */
  agreedByName?: string | null;
  /** Reopen the question. Omitted on the landing-page demo. */
  onClear?: (() => void) | undefined;
};

export function Slots({
  result,
  members,
  onPick,
  selected,
  viewerZone = null,
  agreedByName = null,
  onClear,
}: SlotsProps) {
  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  // Same fallback ladder as the timeline: the member's saved zone, else the
  // browser's, resolved after mount so the server and client first paint agree.
  //
  // Falling back to UTC instead (as this did) put the chips in UTC while the
  // panel under them showed Toronto, and the strip below announced the
  // browser's zone — three different answers to "what time is it" on one page.
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  useEffect(() => {
    setBrowserZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  const zone = viewerZone ?? browserZone ?? 'UTC';

  const days = useMemo(() => {
    if (result.kind !== 'slots') return [];
    // Grouped by the viewer's own calendar day. Grouping in UTC would split a
    // single evening across two headings for anyone west of Greenwich.
    const groups = new Map<string, { label: string; slots: Slot[] }>();
    for (const slot of result.slots) {
      const dt = DateTime.fromMillis(slot.start, { zone });
      const key = dt.toISODate() ?? String(slot.start);
      const existing = groups.get(key);
      if (existing) existing.slots.push(slot);
      else groups.set(key, { label: dt.toFormat('ccc d LLL'), slots: [slot] });
    }
    // The engine hands slots over in rank order, and insertion order followed
    // it, so an earlier but lower-ranked day was printed after later ones
    // (Mon 21 Sep below Sun 4 Oct). Days read as a calendar, so sort them as
    // one; "best" is still marked from slots[0], not from position. ISO dates
    // sort chronologically as strings, and chips within a day go by time.
    return [...groups.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, group]) => ({ ...group, slots: group.slots.sort((a, b) => a.start - b.start) }));
  }, [result, zone]);

  if (result.kind === 'none') {
    return <NoSlots blockers={result.blockers} membersById={membersById} />;
  }
  if (result.slots.length === 0) {
    return (
      <SlitFrame className="p-6">
        <Meta as="div">No times found. Try a longer horizon.</Meta>
      </SlitFrame>
    );
  }

  // Shown in the detail panel. Falls back to the best-ranked option so the
  // panel is never empty and the recommendation is visible without a click.
  const focused = selected ?? result.slots[0];
  const isAgreed = Boolean(selected);

  return (
    <div className="flex flex-col gap-6">
      {/* Days flow across the width rather than stacking one per row. When
          every candidate falls on a different day (common over a long
          horizon), a single column ran ten days deep, pushed the panel with
          the only action below the fold, and left the rest of the row empty. */}
      <div
        role="radiogroup"
        aria-label="Suggested meeting times"
        className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-5"
      >
        {days.map((day) => (
          <div key={day.label} className="flex flex-col gap-2">
            <Meta as="div">{day.label}</Meta>
            <div className="flex flex-wrap gap-2">
              {day.slots.map((slot) => (
                <SlotChip
                  key={`${slot.start}-${slot.end}`}
                  slot={slot}
                  zone={zone}
                  selected={isSameSlot(slot, selected)}
                  isBest={slot === result.slots[0]}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {focused ? (
        <Detail
          slot={focused}
          members={members}
          membersById={membersById}
          zone={zone}
          agreed={isAgreed}
          agreedByName={agreedByName}
          onPick={onPick}
          onClear={onClear}
        />
      ) : null}
    </div>
  );
}

function SlotChip({
  slot,
  zone,
  selected,
  isBest,
  onPick,
}: {
  slot: Slot;
  zone: string;
  selected: boolean;
  isBest: boolean;
  onPick: (slot: Slot) => void;
}) {
  const clean = slot.score === 0;
  const time = DateTime.fromMillis(slot.start, { zone }).toFormat('HH:mm');

  // Colour carries one bit — does this cost anyone anything — and the chip
  // still says so in its label for anyone who cannot use the colour.
  const accent = clean ? 'var(--ok)' : 'var(--cost)';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(slot)}
      title={clean ? 'Works for everyone' : 'Costs someone time outside their hours'}
      className="group relative flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors"
      style={{
        background: selected ? accent : 'transparent',
        color: selected ? 'var(--paper)' : 'var(--ink)',
        border: `1px solid ${selected ? accent : 'var(--edge)'}`,
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-1.5 rounded-full"
        style={{ background: selected ? 'var(--paper)' : accent }}
      />
      <span className="tabular-nums">{time}</span>
      {isBest && !selected ? (
        <span className="meta" style={{ color: 'var(--muted)' }}>
          best
        </span>
      ) : null}
      <span className="sr-only">
        {selected ? ' — selected' : ''}
        {clean ? ' — works for everyone' : ' — outside someone’s hours'}
      </span>
    </button>
  );
}

function Detail({
  slot,
  members,
  membersById,
  zone,
  agreed,
  agreedByName,
  onPick,
  onClear,
}: {
  slot: Slot;
  members: Member[];
  membersById: Map<string, Member>;
  zone: string;
  agreed: boolean;
  agreedByName: string | null;
  onPick: (slot: Slot) => void;
  onClear?: (() => void) | undefined;
}) {
  const burden = burdenCopy(slot.costs, membersById);
  const headline = DateTime.fromMillis(slot.start, { zone }).toFormat('ccc d LLL, HH:mm');

  return (
    <SlitFrame bright className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Meta as="h2" style={agreed ? { color: 'var(--ok)' } : undefined}>
          {agreed ? 'Agreed' : 'Best match'}
        </Meta>
        {agreed && agreedByName ? <Meta as="span">picked by {agreedByName}</Meta> : null}
      </div>

      <div className="text-(length:--text-heading-sm) text-(--ink)">{headline}</div>

      {/* Everyone's local time, for this one option only. Printing it for
          every candidate at once was most of the old layout's bulk. */}
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <MemberTag name={m.name} tag={m.tag} color={m.color} />
            <span className="text-sm text-(--muted)">{m.name}</span>
            <span className="text-sm tabular-nums text-(--ink)">
              {formatForMember(slot.start, m)}
            </span>
          </li>
        ))}
      </ul>

      <Meta as="div" style={slot.score === 0 ? undefined : { color: 'var(--cost)' }}>
        {burden}
      </Meta>

      <div className="flex flex-wrap items-center gap-3">
        {agreed ? (
          <>
            <Pill onClick={() => onPick(slot)}>Add to calendar</Pill>
            {onClear ? <GhostButton onClick={onClear}>Pick a different time</GhostButton> : null}
          </>
        ) : (
          <Pill onClick={() => onPick(slot)}>Choose this time</Pill>
        )}
      </div>
    </SlitFrame>
  );
}

function NoSlots({
  blockers,
  membersById,
}: {
  blockers: { memberId: string; blockedMinutes: number }[];
  membersById: Map<string, Member>;
}) {
  return (
    <SlitFrame className="flex flex-col gap-3 p-6">
      <Meta as="div">No time works yet</Meta>
      <ul className="flex flex-col gap-2">
        {blockers.map((b) => {
          const name = membersById.get(b.memberId)?.name ?? 'Someone';
          const hours = Math.max(1, Math.round(b.blockedMinutes / 60));
          return (
            <li key={b.memberId} className="text-sm text-(--ink)">
              {name} is unavailable for {hours}h of the search window — try a longer horizon, or
              ask {name} to widen their hours.
            </li>
          );
        })}
      </ul>
    </SlitFrame>
  );
}

function isSameSlot(a: Slot, b: Slot | undefined): boolean {
  return b !== undefined && a.start === b.start && a.end === b.end;
}

function formatForMember(instant: number, member: Member): string {
  return DateTime.fromMillis(instant, { zone: member.timezone }).toFormat('HH:mm');
}

/**
 * The honest cost line.
 *
 * Never claims the burden rotates between meetings: the scorer is stateless
 * and has no memory of who took the last early call, so saying so would be
 * false.
 */
function burdenCopy(costs: MemberCost[], membersById: Map<string, Member>): string {
  const paying = costs.filter((c) => c.penalty > 0);
  if (paying.length === 0) return 'Works for everyone.';

  const parts = paying.map((c) => {
    const name = membersById.get(c.memberId)?.name ?? 'someone';
    if (c.reason === 'early') return `an early start for ${name}`;
    if (c.reason === 'late') return `a late night for ${name}`;
    return `outside ${name}'s hours`;
  });

  if (parts.length === 1) return `Costs ${parts[0]}.`;
  return `Costs ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`;
}
