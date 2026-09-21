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
  chooseSlotAction,
  clearChosenAction,
  sendInviteAction,
  type SendInviteResult,
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
   *  lets them send the circle's invite. */
  googleConnected?: boolean;
  /** `?calendar=` from a return trip through Google, to say how it went. */
  calendarNotice?: string | null;
  /** The member this browser is, if any. */
  viewerId?: string | null;
  /** The invite that went out, and whose calendar it lives on. */
  invite?: { start: number; end: number; organizerId: string } | null;
  /** Members an invite would reach (an address, and they opted in). Ids only. */
  invitable?: string[];
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
  viewerId = null,
  invite = null,
  invitable = [],
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
        viewerId={viewerId}
        invite={invite}
        invitable={invitable}
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
  'invite-sent': 'Invite sent. Google is emailing everyone on it.',
  'invite-declined':
    'Invite not sent: Google was not given permission to add events. The .ics download still works.',
  'invite-failed': 'Could not send the invite through Google. The .ics download still works.',
};

/** Sending the invite, per slot, so a state never leaks onto a different time. */
type Sending =
  | { key: string; status: 'sending' | 'redirecting' | 'failed' }
  | { key: string; status: 'sent'; htmlLink: string | null }
  | { key: string; status: 'needs-permission'; url: string };

const slotKey = (slot: { start: number; end: number }) => `${slot.start}-${slot.end}`;

/** "Matthew", "Matthew and Reeti", "Matthew, Reeti and Jan". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

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
  viewerId = null,
  invite = null,
  invitable = [],
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

  const [sending, setSending] = useState<Sending | null>(null);
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
  // announce "Invite sent" again to someone who did nothing.
  useEffect(() => {
    if (!calendarNotice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('calendar');
    window.history.replaceState(null, '', url.toString());
  }, [calendarNotice]);

  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name ?? null;

  // The invite lives on the organizer's calendar and moves with the time, so
  // the organizer is whoever sent it first; until then, whoever sends it now.
  const organizerId =
    invite && members.some((m) => m.id === invite.organizerId) ? invite.organizerId : viewerId;
  const others = members.filter((m) => m.id !== organizerId);
  const guests = others.filter((m) => invitable.includes(m.id)).map((m) => m.name);
  const unreachable = others.filter((m) => !invitable.includes(m.id)).map((m) => m.name);

  /**
   * Only ever from an explicit click. Picking a time used to write it to
   * Google as a side effect, so browsing the options filled someone's
   * calendar with every time they looked at. Now picking proposes; this
   * commits, and it is the one step that reaches anyone else's inbox.
   */
  const sendInvite = async (slot: Slot) => {
    const key = slotKey(slot);
    setNotice(null);
    setSending({ key, status: 'sending' });
    let outcome: SendInviteResult;
    try {
      outcome = await sendInviteAction(slug, slot.start, slot.end);
    } catch {
      outcome = { status: 'failed' };
    }
    switch (outcome.status) {
      case 'sent':
        setSending({ key, status: 'sent', htmlLink: outcome.htmlLink });
        return;
      case 'needs-permission':
        setSending({ key, status: 'redirecting' });
        window.location.assign(outcome.url);
        return;
      default:
        setSending({ key, status: 'failed' });
    }
  };

  // Reopening the question is the inverse of picking, and belongs beside it
  // rather than in a separate banner: one panel owns the decision. It leaves
  // any invite alone: moving that is a deliberate send, not a side effect.
  const handleClear = () => {
    setJustActed(false);
    setSelected(undefined);
    setSending(null);
    setNotice(null);
    startTransition(() => {
      void clearChosenAction(slug);
    });
  };

  // Picking a slot is the moment the globe earns its place (PLAN.md §6):
  // it sets the shared clock's focus, which rotates the terminator to show
  // who is in daylight and who isn't at that time. It writes to no calendar:
  // clicking through the options is how people compare them.
  const handlePick = (slot: Slot) => {
    setJustActed(true);
    setSelected(slot);
    setNotice(null);
    focus(slot.start);
    // Record it for the whole circle, not just this browser. Before this, the
    // only trace of a decision was a file in one person's downloads folder, so
    // the group still had to agree again somewhere else. It also supplies the
    // confirmation the click previously lacked: the agreed banner appears.
    startTransition(() => {
      void chooseSlotAction(slug, slot.start, slot.end);
    });
  };

  const calendarActions = (slot: Slot) => {
    const key = slotKey(slot);
    const icsHref = `/api/ics?slug=${encodeURIComponent(slug)}&start=${slot.start}&end=${slot.end}`;
    const state = sending?.key === key ? sending : null;
    const inviteHere = invite !== null && slotKey(invite) === key;
    const linkClass = 'meta underline underline-offset-4 hover:text-(--ink)';
    const lineClass = 'meta w-full normal-case tracking-normal text-(--muted)';
    const icsLink = (
      <a href={icsHref} className={linkClass}>
        Download .ics
      </a>
    );

    if (inviteHere || state?.status === 'sent') {
      const by = organizerId === viewerId ? 'you' : (nameOf(organizerId) ?? 'someone');
      const link = state?.status === 'sent' ? state.htmlLink : null;
      return (
        <>
          <span className="meta" style={{ color: 'var(--ok)' }}>
            Invite sent by {by}
          </span>
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Open it
            </a>
          ) : null}
          {icsLink}
          <p className={lineClass}>
            {guests.length ? `Sent to ${nameList(guests)}. ` : ''}
            {unreachable.length
              ? `${nameList(unreachable)} ${unreachable.length === 1 ? 'has' : 'have'} no invite email set, so send them the .ics.`
              : ''}
          </p>
        </>
      );
    }

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
          <p className={lineClass}>
            {invite
              ? `${nameOf(invite.organizerId) ?? 'Someone'} sent an invite for a different time. Connect Google Calendar to move it here.`
              : 'Connect Google Calendar to send everyone the invite.'}
          </p>
        </>
      );
    }

    const busy = state?.status === 'sending' || state?.status === 'redirecting';
    return (
      <>
        <Pill disabled={busy} onClick={() => void sendInvite(slot)}>
          {state?.status === 'sending'
            ? 'Sending…'
            : state?.status === 'redirecting'
              ? 'Opening Google…'
              : invite
                ? 'Move the invite to this time'
                : 'Send invite to everyone'}
        </Pill>
        {icsLink}
        <p className={lineClass}>
          {invite
            ? `Everyone on ${organizerId === viewerId ? 'your' : `${nameOf(organizerId) ?? 'the'}’s`} invite gets the new time. `
            : guests.length
              ? `Google emails the invite to ${nameList(guests)}. `
              : 'Nobody else has an invite email set yet, so it goes on your calendar only. '}
          {unreachable.length
            ? `${nameList(unreachable)} ${unreachable.length === 1 ? 'has' : 'have'} no invite email set.`
            : ''}
        </p>
      </>
    );
  };

  const sendState = selected && sending?.key === slotKey(selected) ? sending.status : null;
  const status = pending
    ? 'Saving this time for the circle…'
    : notice
      ? notice
      : sendState === 'sent'
        ? 'Invite sent. Google is emailing everyone on it.'
        : sendState === 'failed'
          ? 'Could not send the invite through Google. The .ics download still works.'
          : justActed && selected
            ? googleConnected
              ? 'Saved for everyone. Send the invite once you are all set.'
              : 'Saved for everyone.'
            : ' ';
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
