'use client';

/**
 * The ranked-slot list: the entire point of Overlap. Nobody reading this
 * list should have to convert a time into their own zone by hand, and
 * nobody should ever land on an empty box — a `kind: 'none'` result gets a
 * named blocker and a next action instead.
 */

import { useMemo } from 'react';
import { DateTime } from 'luxon';
import { GhostButton, Meta, MemberTag, Pill, SlitFrame } from '@/components/ui';
import type { Member, MemberCost, Slot, SuggestResult } from '@/lib/schedule/types';

type SlotsProps = {
  result: SuggestResult;
  members: Member[];
  onPick: (slot: Slot) => void;
  selected?: Slot;
};

export function Slots({ result, members, onPick, selected }: SlotsProps) {
  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  if (result.kind === 'none') {
    return <NoSlots blockers={result.blockers} membersById={membersById} />;
  }

  if (result.slots.length === 0) {
    // The engine's own contract reserves the empty array for `kind: 'none'`,
    // but a defensive fallback costs nothing and keeps this component from
    // ever rendering a blank box if that contract is ever violated upstream.
    return (
      <SlitFrame className="p-6">
        <Meta as="div">No times found. Try a longer horizon.</Meta>
      </SlitFrame>
    );
  }

  const anySelected = result.slots.some((slot) => isSameSlot(slot, selected));

  return (
    <ol className="flex flex-col gap-6" role="radiogroup" aria-label="Suggested meeting times">
      {result.slots.map((slot, rank) => (
        <li key={`${slot.start}-${slot.end}`}>
          <SlotRow
            slot={slot}
            rank={rank}
            members={members}
            membersById={membersById}
            selected={isSameSlot(slot, selected)}
            anySelected={anySelected}
            onPick={onPick}
          />
        </li>
      ))}
    </ol>
  );
}

function SlotRow({
  slot,
  rank,
  members,
  membersById,
  selected,
  anySelected,
  onPick,
}: {
  slot: Slot;
  rank: number;
  members: Member[];
  membersById: Map<string, Member>;
  selected: boolean;
  anySelected: boolean;
  onPick: (slot: Slot) => void;
}) {
  const isTop = rank === 0;
  const burden = burdenCopy(slot.costs, membersById);

  // Exactly one row is ever the "live" one.
  //
  // Before this, rank 0 carried a filled pill permanently while every other
  // row carried an identical ghost button, so the list read as several equally
  // available actions and clicking one changed nothing about the others. There
  // was no way to see which time was actually agreed. Now the state is
  // singular and visible: the selected row is the one that is bright, labelled,
  // and carries the page's single filled action. Until something is selected
  // the best-ranked row holds that position, because a list of options with no
  // recommended one is its own kind of unhelpful.
  const isLive = selected || (!anySelected && isTop);

  return (
    <SlitFrame
      bright={isLive}
      className={`flex flex-col gap-4 p-6 transition-opacity ${
        anySelected && !selected ? 'opacity-55' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        {/* A radio, not a button: choosing a time is picking one of a set, and
            the control should say so to a screen reader as well as to the eye. */}
        <span
          aria-hidden="true"
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border"
          style={{
            borderColor: selected ? 'var(--pulse)' : 'var(--edge)',
            background: selected ? 'var(--pulse)' : 'transparent',
          }}
        >
          {selected ? (
            <span className="size-1.5 rounded-full" style={{ background: 'var(--paper)' }} />
          ) : null}
        </span>
        <Meta as="div" style={selected ? { color: 'var(--pulse)' } : undefined}>
          {selected ? 'Agreed' : isTop ? 'Best match' : `Option ${rank + 1}`}
        </Meta>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2">
            <MemberTag name={m.name} tag={m.tag} color={m.color} />
            {/* The name, not just the tag. A bare two-letter code is a puzzle
                to anyone who has not already studied the timeline gutter. */}
            <span className="text-sm text-(--muted)">{m.name}</span>
            <span className="text-sm text-(--ink)">{formatForMember(slot.start, m)}</span>
          </div>
        ))}
      </div>

      {/* Burden line. Deliberately silent for a clean slot rather than
          printing "works for everyone" in every case that isn't clean —
          see burdenCopy for why zero-cost is the one line that IS printed. */}
      <Meta as="div">{burden}</Meta>

      <div>
        {selected ? (
          // Ghost, not filled: once a time is agreed the banner above owns the
          // page's one filled action, and two identical pills on screen was
          // exactly the ambiguity that made this list feel like a multi-select.
          <GhostButton onClick={() => onPick(slot)} aria-pressed>
            Re-download calendar file
          </GhostButton>
        ) : isLive ? (
          <Pill onClick={() => onPick(slot)} aria-pressed={false}>
            Choose this time
          </Pill>
        ) : (
          <GhostButton onClick={() => onPick(slot)} aria-pressed={false}>
            Choose this time
          </GhostButton>
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

/**
 * Copy from `Slot.costs`. `work` (penalty 0) says nothing — most members on
 * most slots are simply fine, and repeating that for every member would
 * bury the one or two lines that actually matter. If *every* cost is zero
 * the slot reads as "works for everyone," which is the one case worth
 * saying explicitly, because a silent line and a genuinely clean slot would
 * otherwise look identical.
 *
 * This never claims the burden rotates — the engine has no memory of past
 * meetings, so saying "it's someone else's turn" would be a straightforward
 * lie. It says whose night this is, not whose turn it is.
 */
function burdenCopy(costs: MemberCost[], membersById: Map<string, Member>): string {
  const lines: string[] = [];
  for (const cost of costs) {
    if (cost.penalty <= 0) continue;
    const name = membersById.get(cost.memberId)?.name ?? 'someone';
    switch (cost.reason) {
      case 'off-hours':
        lines.push(`outside ${name}'s hours`);
        break;
      case 'early':
        lines.push(`an early start for ${name}`);
        break;
      case 'late':
        lines.push(`a late night for ${name}`);
        break;
      case 'work':
        break;
    }
  }
  if (lines.length === 0) return 'Works for everyone.';
  return lines.join(' · ');
}

/** `member.timezone` is the only zone that matters here — the whole point
 *  of this list is that nobody converts by hand. */
function formatForMember(startMs: number, member: Member): string {
  return DateTime.fromMillis(startMs, { zone: member.timezone }).toFormat('ccc d LLL · HH:mm');
}

function isSameSlot(a: Slot, b: Slot | undefined): boolean {
  return b !== undefined && a.start === b.start && a.end === b.end;
}
