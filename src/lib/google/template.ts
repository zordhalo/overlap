/**
 * Kept apart from `events.ts` so client components can import it: this file
 * has no Node dependencies and makes no requests.
 */

/**
 * A prefilled "create event" page in Google Calendar. Needs no grant at all,
 * so it is what people without a connected Google account are offered: one
 * click to open, one to save, and nothing to download.
 */
export function googleTemplateUrl(input: {
  start: number;
  end: number;
  summary: string;
  description: string;
  url: string;
}): string {
  const format = (ms: number) =>
    new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', input.summary);
  url.searchParams.set('dates', `${format(input.start)}/${format(input.end)}`);
  url.searchParams.set('details', `${input.description}\n\n${input.url}`);
  return url.toString();
}
