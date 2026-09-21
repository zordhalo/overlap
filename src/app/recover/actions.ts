'use server';

import { headers } from 'next/headers';
import {
  circlesForEmailHash,
  emailLookupHash,
  throttleRecovery,
  type RecoverableCircle,
} from '@/lib/db/queries';
import { signSigninToken } from '@/lib/signin-token';
import { isEmailConfigured, looksLikeEmail, normaliseEmail, sendEmail } from '@/lib/email';

export type RecoverState = { status: 'idle' | 'sent' | 'invalid' | 'unavailable'; message?: string };

function baseUrl(host: string | null): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  return host ? `https://${host}` : 'https://overlap.runs-on.dev';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type EmailCircle = RecoverableCircle & { signinUrl: string; circleUrl: string };

/**
 * Two links per circle, because they do different jobs. The sign-in link
 * makes this browser *you* again, so you can edit yourself, but it expires.
 * The circle link never expires and is what to keep, but on its own it opens
 * the circle as a visitor.
 */
function renderEmail(circles: EmailCircle[]) {
  const text = [
    'Here are the Overlap circles linked to this address.',
    '',
    ...circles.flatMap((c) => [
      `${c.circleName} (you are ${c.memberName})`,
      `  Sign in as yourself: ${c.signinUrl}`,
      `  Circle link to keep: ${c.circleUrl}`,
      '',
    ]),
    'The sign-in links work for 24 hours. After that, ask for a new email from the recovery page.',
    'If you did not ask for this, you can ignore it: nothing has changed.',
  ].join('\n');

  const items = circles
    .map(
      (c) =>
        `<li style="margin:0 0 16px"><strong>${escapeHtml(c.circleName)}</strong>` +
        `<span style="color:#666"> · you are ${escapeHtml(c.memberName)}</span><br>` +
        `<a href="${c.signinUrl}" style="color:#101010">Sign in as yourself</a><br>` +
        `<span style="color:#666;font-size:13px">Circle link to keep: ${c.circleUrl}</span></li>`,
    )
    .join('');

  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#101010">',
    '<p>Here are the Overlap circles linked to this address.</p>',
    `<ul style="padding-left:18px">${items}</ul>`,
    '<p style="color:#666;font-size:13px">The sign-in links work for 24 hours. After that, ask for a new email from the recovery page. If you did not ask for this, you can ignore it: nothing has changed.</p>',
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * Send someone their circle links, if that address has any.
 *
 * The response is IDENTICAL whether the address is known, unknown, throttled,
 * or the send failed. Recovery endpoints are the classic enumeration oracle: a
 * different message for "no circles" would turn this into a way to test
 * whether any given person uses Overlap, and a circle page exposes somebody's
 * timezone, sleeping hours and busy pattern. The only place the answer ever
 * appears is the inbox itself.
 */
export async function recoverAction(
  _prev: RecoverState,
  formData: FormData,
): Promise<RecoverState> {
  if (!isEmailConfigured()) return { status: 'unavailable' };

  const email = normaliseEmail(String(formData.get('email') ?? ''));

  // The one thing worth answering honestly: a malformed address is the user's
  // own typo, and staying silent just makes them wait for mail that was never
  // going to arrive.
  if (!looksLikeEmail(email)) {
    return { status: 'invalid', message: 'That does not look like an email address.' };
  }

  const sent: RecoverState = { status: 'sent' };

  try {
    const headerList = await headers();
    const ip =
      headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? '';
    const hash = emailLookupHash(email);

    // Both limits are checked and both record an attempt: the address limit
    // stops one inbox being mail-bombed, the caller limit stops one requester
    // walking a list of addresses.
    const addressBlocked = await throttleRecovery(`hash:${hash}`);
    const callerBlocked = ip ? await throttleRecovery(`ip:${ip}`) : false;
    if (addressBlocked || callerBlocked) return sent;

    const circles = await circlesForEmailHash(hash);
    if (circles.length === 0) return sent;

    const origin = baseUrl(headerList.get('host'));
    const { text, html } = renderEmail(
      circles.map((c) => ({
        ...c,
        circleUrl: `${origin}/c/${c.slug}`,
        signinUrl: `${origin}/c/${c.slug}/signin?t=${encodeURIComponent(
          signSigninToken({ slug: c.slug, memberId: c.memberId, emailHash: hash }),
        )}`,
      })),
    );
    await sendEmail({
      to: email,
      subject: circles.length === 1 ? 'Your Overlap circle' : 'Your Overlap circles',
      text,
      html,
    });
  } catch {
    // Swallowed on purpose: a failure must not be distinguishable from
    // success, or the difference becomes the oracle this avoids.
  }

  return sent;
}
