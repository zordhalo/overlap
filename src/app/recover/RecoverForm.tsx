'use client';

import { useActionState } from 'react';
import { Meta, Pill } from '@/components/ui';
import { recoverAction, type RecoverState } from './actions';

const INITIAL: RecoverState = { status: 'idle' };

export function RecoverForm() {
  const [state, action, pending] = useActionState(recoverAction, INITIAL);

  if (state.status === 'sent') {
    return (
      <div
        className="flex flex-col gap-3 rounded-2xl p-6"
        style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
      >
        <Meta as="div" style={{ color: 'var(--ok)' }}>
          Check your inbox
        </Meta>
        <p className="text-sm text-(--muted)">
          If that address is on any circle, the links are on their way. Nothing is shown here on
          purpose — the answer only ever goes to the inbox, so this page can never be used to
          check whether somebody uses Overlap.
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl p-6"
      style={{ background: 'var(--card)', border: '1px solid var(--edge)' }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="meta">
          Your email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="rounded-full px-4 py-2.5 text-sm text-(--ink)"
          style={{ background: 'var(--paper)', border: '1px solid var(--edge)' }}
        />
      </div>

      {state.status === 'invalid' ? (
        <p className="text-sm" style={{ color: 'var(--flag)' }}>
          {state.message}
        </p>
      ) : null}
      {state.status === 'unavailable' ? (
        <p className="text-sm" style={{ color: 'var(--flag)' }}>
          Recovery by email is not enabled on this deployment.
        </p>
      ) : null}

      <div>
        <Pill type="submit" disabled={pending}>
          {pending ? 'Sending…' : 'Email me my circles'}
        </Pill>
      </div>
    </form>
  );
}
