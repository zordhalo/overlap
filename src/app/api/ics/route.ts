/**
 * Downloads a chosen slot as a `.ics` file. Generation itself is delegated
 * to `@/lib/ics` (owned by another agent) — this route's own job is only
 * request validation and turning the result into a file download.
 *
 * No session/auth check beyond the circle's slug itself: same capability
 * model as the rest of Overlap (holding the link is the authorization), and
 * this endpoint only ever produces a downloadable file from data the
 * requester could already see on the circle page — it does not write
 * anything or expose data the visitor didn't already have.
 */
import { NextResponse } from 'next/server';
import { customAlphabet } from 'nanoid';
import { buildIcs } from '@/lib/ics';
import { getCircleBySlug } from '@/lib/db/queries';

/** A day is a generous ceiling for a single meeting slot — well above
 *  anything `suggest()` would ever produce (`durationMinutes` is capped at
 *  1440 at the circle level anyway) — kept here as an independent boundary
 *  check rather than trusting the circle's own stored value. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

const generateUid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);

type IcsRequestBody = {
  slug?: unknown;
  start?: unknown;
  end?: unknown;
};

function isFiniteInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * One validation path for both entry points. A query string is no more
 * trustworthy than a JSON body, so neither gets its own rules.
 */
async function buildIcsResponse(
  input: { slug?: unknown; start?: unknown; end?: unknown },
  origin: string,
): Promise<Response> {
  const { slug, start, end } = input;
  if (typeof slug !== 'string' || !slug) {
    return NextResponse.json({ error: '"slug" is required.' }, { status: 400 });
  }
  if (!isFiniteInt(start) || !isFiniteInt(end)) {
    return NextResponse.json({ error: '"start" and "end" must be epoch-ms integers.' }, { status: 400 });
  }
  if (end <= start) {
    return NextResponse.json({ error: '"end" must be after "start".' }, { status: 400 });
  }
  if (end - start > MAX_DURATION_MS) {
    return NextResponse.json({ error: 'Slot is longer than the 24h maximum.' }, { status: 400 });
  }

  const circle = await getCircleBySlug(slug);
  if (!circle) {
    return NextResponse.json({ error: `No circle found for "${slug}".` }, { status: 404 });
  }

  const ics = buildIcs({
    uid: `${generateUid()}@overlap`,
    start,
    end,
    summary: circle.name,
    description: 'Scheduled with Overlap.',
    url: `${origin}/c/${slug}`,
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // Quotes stripped from the slug so a crafted value cannot break out of
      // the filename parameter.
      'Content-Disposition': `attachment; filename="${slug.replace(/[^A-Za-z0-9_-]/g, '')}.ics"`,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: IcsRequestBody;
  try {
    body = (await request.json()) as IcsRequestBody;
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  return buildIcsResponse(body, new URL(request.url).origin);
}

/**
 * Same file, via a plain link.
 *
 * POST suits the in-page "use this time" flow, where the slot is transient and
 * nothing should be navigable. The agreed time is different: it is durable
 * state on the circle, so it deserves an ordinary anchor that works without
 * JavaScript, can be right-clicked, and survives being forwarded.
 *
 * Reuses the POST path's validation rather than duplicating it — the query
 * string is no more trustworthy than a body.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  return buildIcsResponse(
    {
      slug: params.get('slug'),
      start: Number(params.get('start')),
      end: Number(params.get('end')),
    },
    new URL(request.url).origin,
  );
}
