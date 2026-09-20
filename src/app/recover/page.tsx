import Link from 'next/link';
import { Meta } from '@/components/ui';
import { isEmailConfigured } from '@/lib/email';
import { RecoverForm } from './RecoverForm';

export const metadata = {
  title: 'Find your circles · Overlap',
  description: 'Get your Overlap circle links emailed to you.',
};

export default function RecoverPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <Meta as="div">Overlap</Meta>
        <h1 className="text-(length:--text-heading) leading-(--text-heading--line-height) tracking-(--text-heading--letter-spacing) text-(--ink)">
          Find your circles
        </h1>
        <p className="max-w-prose text-(length:--text-body) text-(--muted)">
          A circle link is the only way in, and there is no account behind it. If you added an
          email when you joined, we can send your links again.
        </p>
      </div>

      {isEmailConfigured() ? (
        <RecoverForm />
      ) : (
        <div
          className="rounded-2xl p-6 text-sm text-(--muted)"
          style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
        >
          Recovery by email is not enabled on this deployment.
        </div>
      )}

      <Meta as="p" className="normal-case tracking-normal text-(--muted)">
        Never added an email? Then there is nothing to send: Overlap has no account, no password
        and no other record of you. Ask anyone else in the circle to re-share the link. If you are
        the only member, it is easiest to{' '}
        <Link href="/" className="text-(--ink) underline underline-offset-4">
          start a new one
        </Link>
        .
      </Meta>
    </main>
  );
}
