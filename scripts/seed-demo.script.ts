/**
 * Creates a demo circle with members in genuinely distant zones, so the
 * product can be seen working before anyone has typed anything.
 *
 * The members are labelled examples on purpose. Real co-founder time zones are
 * not guessed here — inventing them would put confident wrong data in front of
 * someone who would reasonably assume it was real.
 *
 * Run: npx vitest run --config vitest.scripts.config.ts
 */

import { it } from 'vitest';
import { createCircle, addMember, getCircleBySlug, toScheduleMembers } from '@/lib/db/queries';
import { suggest } from '@/lib/schedule';

const EXAMPLES = [
  // Spread deliberately: a 4.5h gap and a 9.5h gap, so the overlap is narrow
  // enough to be interesting rather than trivially "any time works".
  { name: 'Example · Toronto', timezone: 'America/Toronto', sleepStart: 23 * 60, sleepEnd: 7 * 60, workStart: 9 * 60, workEnd: 17 * 60 },
  { name: 'Example · London', timezone: 'Europe/London', sleepStart: 23 * 60 + 30, sleepEnd: 7 * 60 + 30, workStart: 9 * 60, workEnd: 17 * 60 + 30 },
  { name: 'Example · Bengaluru', timezone: 'Asia/Kolkata', sleepStart: 0, sleepEnd: 7 * 60 + 30, workStart: 10 * 60, workEnd: 19 * 60 },
];

it('seeds a demo circle and prints its slug', async () => {
  // createCircle returns only the slug — the id is deliberately not part of
  // its contract, since the slug is the only handle anything outside the db
  // layer should hold. Read it back to get the id for addMember.
  const created = await createCircle({ name: 'Demo circle', durationMinutes: 45, horizonDays: 7 });
  const fresh = await getCircleBySlug(created.slug);
  if (!fresh) throw new Error('created circle did not read back');
  for (const m of EXAMPLES) await addMember(fresh.id, m);

  const loaded = await getCircleBySlug(created.slug);
  if (!loaded) throw new Error('seeded circle did not read back');

  const members = toScheduleMembers(loaded);
  const result = suggest(members, {
    durationMinutes: loaded.durationMinutes,
    horizonDays: loaded.horizonDays,
    from: Date.now(),
  });

  console.log(`\nslug: ${created.slug}`);
  console.log(`members: ${members.map((m) => `${m.tag} ${m.name} (${m.timezone})`).join(', ')}`);

  if (result.kind === 'none') {
    console.log('\nNo slot fits. Blockers:', result.blockers);
  } else {
    console.log(`\nTop ${Math.min(5, result.slots.length)} of ${result.slots.length} slots:`);
    for (const s of result.slots.slice(0, 5)) {
      const perZone = members
        .map((m) => `${m.tag} ${new Intl.DateTimeFormat('en-GB', { timeZone: m.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(s.start)}`)
        .join('  ');
      const costs = s.costs.filter((c) => c.penalty > 0).map((c) => `${c.memberId.slice(0, 4)}:${c.reason}`);
      console.log(`  score ${String(s.score).padStart(3)}  ${perZone}${costs.length ? `   [${costs.join(' ')}]` : '   [clean]'}`);
    }
  }
});
