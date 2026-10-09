'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GhostButton, Meta } from '@/components/ui';
import { locationPermission } from '@/lib/geo-permission';
import type { LocationFailure } from '@/lib/geo-timezone';
import type { GroupedZones } from '@/lib/zones';

/**
 * The timezone picker, plus the second opinion that keeps it honest.
 *
 * A device clock cannot detect its own misconfiguration, and a member whose
 * OS is set to the wrong zone poisons every suggestion the circle gets —
 * silently, because the form looks right to them. Satellite and wifi
 * positioning fail differently, so a disagreement between the two is worth
 * surfacing loudly and worth resolving by asking, never by overriding: a
 * member on a trip who deliberately keeps their home zone is just as real
 * as one with a wrong clock, and only they can tell the two apart.
 *
 * The lookup table is a 90KB import, so it arrives via `import()` at the
 * moment a reading is actually taken — never on a page view, and never for
 * someone who has refused.
 */

type Reading =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'zone'; zone: string }
  | { kind: 'error'; error: LocationFailure };

/** What to tell someone whose reading did not arrive. A refusal is not an
 *  error — it is an answer, and the form works without it. */
const FAILURE_COPY: Record<LocationFailure, string> = {
  denied:
    'Location is blocked for this site. Your browser will not ask again until you reset it in the address bar.',
  timeout: 'Your browser took too long to find a location. The zone below is still yours to set.',
  unavailable: 'Your browser could not get a location. The zone below is still yours to set.',
};

export function TimezoneField({
  zoneGroups,
  defaultZone,
  deviceZone,
}: {
  zoneGroups: GroupedZones;
  /** The starting value: a returning member's saved zone, else the device's. */
  defaultZone: string;
  /** What `Intl` reports, named separately so a mismatch can say which
   *  source claimed what instead of just announcing a different answer. */
  deviceZone: string;
}) {
  const [zone, setZone] = useState(defaultZone);
  const [reading, setReading] = useState<Reading>({ kind: 'idle' });
  const [canAsk, setCanAsk] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const locate = useCallback(async () => {
    setReading({ kind: 'locating' });
    setDismissed(false);
    const { detectByLocation } = await import('@/lib/geo-timezone');
    const result = await detectByLocation();
    setReading('zone' in result ? { kind: 'zone', zone: result.zone } : { kind: 'error', ...result });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void locationPermission().then((state) => {
      if (cancelled) return;
      // Already granted: read it now, every visit, with no prompt and no
      // click. This is as close to "ask every time" as a browser allows —
      // a site cannot re-raise a dialog the user has already answered.
      if (state === 'granted') void locate();
      // `denied` means calling again shows the member nothing at all, so
      // offering a button would be offering something that does not work.
      else setCanAsk(state !== 'denied');
    });
    return () => {
      cancelled = true;
    };
  }, [locate]);

  // The visitor's own zone may genuinely not be in the curated list, and
  // neither may the one their location resolves to. Both get a one-off
  // option rather than being silently swapped for the nearest listed city.
  const extraOptions = useMemo(() => {
    const listed = new Set(zoneGroups.flatMap((g) => g.zones.map((z) => z.value)));
    const candidates = [defaultZone, zone, reading.kind === 'zone' ? reading.zone : null];
    return [...new Set(candidates.filter((z): z is string => Boolean(z) && !listed.has(z!)))];
  }, [zoneGroups, defaultZone, zone, reading]);

  const suggested = reading.kind === 'zone' && reading.zone !== zone ? reading.zone : null;
  const agrees = reading.kind === 'zone' && reading.zone === zone;
  // A refusal is permanent until the member resets it in their browser, so
  // offering "try again" there would be offering a button that does nothing.
  const retryable = reading.kind === 'error' && reading.error !== 'denied';
  // Three different answers is possible: a returning member's saved zone,
  // a device clock set to something else again, and the location. Only
  // mention the clock when it is actually a third voice in the room.
  const clockDiffers = suggested !== null && deviceZone !== zone && deviceZone !== suggested;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="timezone" className="meta">
          Timezone
        </label>
        {canAsk && (reading.kind === 'idle' || retryable) && (
          <GhostButton type="button" onClick={() => void locate()}>
            {reading.kind === 'error' ? 'Try again' : 'Check my location'}
          </GhostButton>
        )}
        {reading.kind === 'locating' && <Meta as="span">Locating…</Meta>}
      </div>

      <select
        id="timezone"
        name="timezone"
        required
        value={zone}
        onChange={(e) => setZone(e.target.value)}
        className="slit-input rounded-md px-3 py-2 text-(--ink)"
      >
        {extraOptions.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
        {zoneGroups.map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.zones.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {suggested && !dismissed ? (
        // The whole point of the feature. Both sources are named, because
        // "we think you are somewhere else" is not actionable and "your
        // clock says Toronto, your location says Riyadh" is.
        <div
          role="status"
          className="flex flex-col gap-3 rounded-md border p-3"
          style={{ borderColor: 'var(--flag)' }}
        >
          <Meta as="div" style={{ color: 'var(--flag)' }}>
            These do not match
          </Meta>
          <p className="text-sm text-(--muted)">
            This form has you in <span className="text-(--ink)">{zone}</span>. Your location says{' '}
            <span className="text-(--ink)">{suggested}</span>
            {clockDiffers ? (
              <>
                , and your device clock says <span className="text-(--ink)">{deviceZone}</span>
              </>
            ) : null}
            . A wrong zone here moves every time this circle suggests, so it is worth getting
            right.
          </p>
          <div className="flex flex-wrap gap-3">
            <GhostButton type="button" onClick={() => setZone(suggested)}>
              Use {suggested}
            </GhostButton>
            <GhostButton type="button" onClick={() => setDismissed(true)}>
              Keep {zone}
            </GhostButton>
          </div>
        </div>
      ) : agrees ? (
        <Meta as="p" className="normal-case tracking-normal" style={{ color: 'var(--pulse)' }}>
          Your location agrees with this zone.
        </Meta>
      ) : dismissed ? (
        <Meta as="p" className="normal-case tracking-normal">
          Keeping {zone}, the zone you picked.
        </Meta>
      ) : reading.kind === 'error' ? (
        <Meta as="p" className="normal-case tracking-normal">
          {FAILURE_COPY[reading.error]}
        </Meta>
      ) : (
        <Meta as="p" className="normal-case tracking-normal">
          Detected from your browser. Change it if you&apos;re somewhere temporary.
        </Meta>
      )}
    </div>
  );
}
