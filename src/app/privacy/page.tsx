import Link from 'next/link';
import { Meta } from '@/components/ui';

export const metadata = {
  title: 'Privacy · Overlap',
  description:
    'What Overlap stores, what it does not, and how Google Calendar data is used. Overlap reads free/busy only and never event details.',
};

/**
 * Required, not decorative.
 *
 * Google will not let an OAuth app leave testing mode without a privacy policy
 * URL, and this one is registered on the consent screen — a 404 here would be
 * both a broken promise to anyone who follows it and a live compliance gap.
 *
 * Everything below is a claim about what the code does, so it has to stay true
 * to the code. Where a limit exists it is stated as a limit rather than dressed
 * up, and the Google section uses the language of the Limited Use requirements
 * because those are the terms the app is actually bound by.
 */

const UPDATED = '20 September 2026';

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Meta as="div">Overlap</Meta>
        <h1 className="text-(length:--text-heading) leading-(--text-heading--line-height) tracking-(--text-heading--letter-spacing) text-(--ink)">
          Privacy
        </h1>
        <Meta as="p" className="normal-case tracking-normal text-(--muted)">
          Last updated {UPDATED}. Overlap is operated by Advance Labs Inc. and is{' '}
          <a
            href="https://github.com/zordhalo/overlap"
            className="text-(--ink) underline underline-offset-4"
          >
            open source
          </a>
          , so every claim here can be checked against the code.
        </Meta>
      </header>

      <Section title="The short version">
        <P>
          Overlap answers one question: when can a group meet. To do that it needs to know what
          time zone you are in and the hours you keep. It does not need to know what is in your
          calendar, and it does not store that.
        </P>
        <P>There is no account, no password, and no tracking or advertising of any kind.</P>
      </Section>

      <Section title="What is stored">
        <List
          items={[
            'The circle name you choose, and a random link for it.',
            'Your display name, time zone, sleeping hours, and working hours.',
            'Start and end times of your busy periods, if you connect a calendar. Nothing else about those events.',
            'An email address, only if you choose to add one for recovering lost links.',
            'Approximate coordinates of your time zone’s representative city, to place a marker on the globe. This is derived from the zone you picked, not from your device location.',
          ]}
        />
        <P>
          Secrets are encrypted at rest with AES-256-GCM: your email address, and the calendar
          credential if you connect one. Your email is additionally indexed by a keyed hash so
          recovery can find your circles without the database holding a searchable list of
          addresses.
        </P>
      </Section>

      <Section title="What is never stored">
        <List
          items={[
            'Event titles, descriptions, attendees, locations, or any other calendar content. There is no column for them.',
            'Your device location, IP-based location, or precise coordinates.',
            'Passwords, since there are none.',
            'Analytics, advertising identifiers, or third-party trackers.',
          ]}
        />
      </Section>

      <Section title="Google Calendar">
        <P>
          Connecting Google is optional. When you do, Overlap requests exactly one scope,{' '}
          <Code>calendar.freebusy</Code>, which returns only the start and end times of periods
          when you are busy. It cannot read event titles, attendees, or any other content, so the
          promise above is enforced by the interface Google exposes rather than by our restraint.
        </P>
        <P>
          Overlap&rsquo;s use of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-(--ink) underline underline-offset-4"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. That data is used only to show when the people
          in your circle are free, is never sold or transferred, is never used for advertising,
          and is never read by a human.
        </P>
        <P>
          Disconnecting is immediate: remove the connection and the stored credential is deleted.
          You can also revoke Overlap&rsquo;s access at any time from your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-(--ink) underline underline-offset-4"
          >
            Google account permissions
          </a>
          .
        </P>
      </Section>

      <Section title="Who can see your information">
        <P>
          Anyone holding a circle&rsquo;s link can see the names, time zones, and availability of
          everyone in that circle. That is what the tool is for, and it is worth being plain about:
          <strong className="text-(--ink)"> a circle link is the only thing protecting it</strong>,
          so treat it like a shared document link and share it only with the people who should be
          in it.
        </P>
        <P>
          Email addresses are the exception: they are never shown to anyone else in the circle, and
          are used only to send you your own links.
        </P>
      </Section>

      <Section title="Email">
        <P>
          If you add an address, Overlap sends mail to it in exactly one situation: when someone
          asks for that address&rsquo;s circle links to be re-sent. There are no newsletters,
          product updates, or marketing messages, because there is no system here to send them.
        </P>
        <P>
          The recovery page never reveals whether an address is known to us. It shows the same
          response either way, so it cannot be used to check whether a particular person uses
          Overlap.
        </P>
      </Section>

      <Section title="Deleting your information">
        <P>
          Open your circle, choose to change your setup, and you can update or clear what you have
          entered. To remove yourself or a whole circle entirely, email{' '}
          <a href="mailto:privacy@advancelabs.dev" className="text-(--ink) underline underline-offset-4">
            privacy@advancelabs.dev
          </a>{' '}
          with the circle link and it will be deleted.
        </P>
        <P>
          Being straight about a limit: Overlap does not currently expire or automatically delete
          old circles. If that changes, this page changes with it.
        </P>
      </Section>

      <Section title="Where it runs">
        <P>
          Overlap is hosted on Vercel with a Neon Postgres database, and email is sent through
          Resend. Those providers process data on our behalf in order to run the service. Data may
          be stored or processed outside your country.
        </P>
      </Section>

      <Section title="Contact">
        <P>
          Advance Labs Inc., 92-971 Adelaide St S, London, Ontario N6E 2H3, Canada. Questions about
          this page go to{' '}
          <a href="mailto:privacy@advancelabs.dev" className="text-(--ink) underline underline-offset-4">
            privacy@advancelabs.dev
          </a>
          .
        </P>
      </Section>

      <footer className="slit-top pt-6">
        <Meta as="p" className="normal-case tracking-normal text-(--muted)">
          <Link href="/" className="text-(--ink) underline underline-offset-4">
            Back to Overlap
          </Link>
        </Meta>
      </footer>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Meta as="h2">{title}</Meta>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-(length:--text-body) text-(--muted)">{children}</p>;
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5">
      {items.map((item) => (
        <li key={item} className="text-(length:--text-body) text-(--muted)">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="rounded px-1.5 py-0.5 text-sm text-(--ink)"
      style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
    >
      {children}
    </code>
  );
}
