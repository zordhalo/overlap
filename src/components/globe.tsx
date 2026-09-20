'use client';

/**
 * The globe: not decoration, the answer made visible. It orients its
 * day/night terminator to the shared clock's `focusInstant` — the same
 * instant the timeline is drawing — so selecting a suggested slot rotates
 * the globe to *show* who is in daylight and who isn't at that moment.
 *
 * cobe API note, verified empirically (this matters — PLAN.md's cobe notes
 * and cobe's own README both describe an `onRender(state)` callback that
 * this installed build (cobe 2.0.1, `node_modules/cobe/dist/index.esm.js`)
 * does not actually have: the string "onRender" does not appear anywhere in
 * that file, there is no internal `requestAnimationFrame` loop, and
 * `COBEOptions` in `index.d.ts` has no such field. What this build actually
 * does is render once, synchronously, inside `createGlobe` and again on
 * every `globe.update(partial)` call — there is no ambient animation at
 * all unless the caller drives one. So continuous rotation here is a
 * `requestAnimationFrame` loop this component owns, calling `update({phi,
 * theta})` every frame, started only while animation is actually wanted
 * (see the "orientation" effect below) — which conveniently maps exactly
 * onto the reduced-motion/mobile "stop entirely, don't just slow down"
 * requirement: no loop running means no rendering happening, not a frozen
 * fast loop.
 *
 * Every piece of rotation state lives in a ref (`rotationRef`,
 * `targetPhiRef`), not React state, because it is written from a
 * non-React-triggered rAF loop and from pointer event listeners; routing
 * every frame through `setState` would fight React's render cycle for no
 * benefit, since nothing here needs to trigger a re-render.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import createGlobe, { type Globe } from 'cobe';
import type { Member } from '@/lib/schedule/types';
import { useClock, usePrefersReducedMotion } from '@/lib/time/clock';
import { globeTheme, hexToRgbFloat } from './globe-theme';
import { isDaylight, phiForLongitude, subsolarLongitude } from './globe-math';

/** Tailwind's `sm` breakpoint, and the line PLAN.md draws for "phone." A
 *  spinning WebGL sphere is a battery cost a phone user did not ask for, so
 *  below this width auto-rotation is off regardless of motion preference. */
const MOBILE_BREAKPOINT_PX = 640;

/** Radians per frame the rotation eases toward its target. Small enough to
 *  read as a smooth drift rather than a snap, slow enough that a 30s clock
 *  tick (see `clock.tsx`'s `tickMs`) doesn't visibly whip the globe around. */
const EASE_RATE = 0.04;

/** Marker radius in cobe's own units (fraction of globe radius). Matches the
 *  scale cobe's own examples use for city-sized markers. */
const MARKER_SIZE = 0.06;

/** Baseline camera tilt (radians) so the globe reads as a sphere rather than
 *  a flat disc before anyone drags it. Clamped drag range keeps it from ever
 *  flipping past the poles into an upside-down view. */
const DEFAULT_THETA = 0.3;
const THETA_LIMIT = 1.2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Shortest-path angular interpolation. A naive `from + (to - from) * t`
 *  breaks at the ±π seam — going from phi=3.1 to phi=-3.1 (a physically tiny
 *  rotation) would otherwise animate the long way around the globe. */
function lerpAngle(from: number, to: number, t: number): number {
  let delta = (to - from) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return from + delta * t;
}

/** True under 640px CSS width. Re-evaluated on resize, same pattern as
 *  `usePrefersReducedMotion` in clock.tsx (frozen, so re-implemented here
 *  rather than imported). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

/**
 * Cheapest reliable way to know whether WebGL will actually render: cobe
 * itself does NOT throw when a context is unavailable — reading its source,
 * a failed `getContext` makes it silently return a no-op `{destroy, update}`
 * pair, which would leave a blank canvas on screen rather than a crash. So
 * WebGL support is probed here, before calling `createGlobe`, and the
 * fallback path renders real content instead of trusting cobe to complain.
 */
function probeWebglSupport(canvas: HTMLCanvasElement): boolean {
  try {
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function formatLocalTime(timezone: string, instant: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(instant));
  } catch {
    // An invalid/unsupported IANA zone string reaching this component is a
    // data problem upstream, not something the globe should crash over.
    return '--:--';
  }
}

type MemberState = {
  member: Member;
  localTime: string;
  /** Null when the member has no coordinates — day/night is unknowable, not
   *  false, so the UI must say "unknown" rather than silently claim night. */
  daylight: boolean | null;
};

function computeMemberStates(members: Member[], focusInstant: number): MemberState[] {
  return members.map((member) => ({
    member,
    localTime: formatLocalTime(member.timezone, focusInstant),
    daylight:
      member.lat !== null && member.lng !== null
        ? isDaylight(member.lat, member.lng, focusInstant)
        : null,
  }));
}

function daylightWord(daylight: boolean | null): string {
  if (daylight === null) return 'location unknown';
  return daylight ? 'daylight' : 'night';
}

export function Globe({ members }: { members: Member[] }) {
  const { focusInstant } = useClock();
  const reducedMotion = usePrefersReducedMotion();
  const isMobile = useIsMobile();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const globeRef = useRef<Globe | null>(null);

  const [webglOk, setWebglOk] = useState(true);
  const [sizePx, setSizePx] = useState(320);

  // Mutable rotation state, written by the rAF loop and pointer handlers
  // below rather than by `setState` (see file header).
  const rotationRef = useRef({ phi: phiForLongitude(subsolarLongitude(focusInstant)), theta: DEFAULT_THETA });
  const targetPhiRef = useRef(rotationRef.current.phi);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; phi: number; theta: number } | null>(null);

  const memberStates = useMemo(
    () => computeMemberStates(members, focusInstant),
    [members, focusInstant],
  );

  const markers = useMemo(
    () =>
      members
        .filter((m): m is Member & { lat: number; lng: number } => m.lat !== null && m.lng !== null)
        .map((m) => ({
          location: [m.lat, m.lng] as [number, number],
          size: MARKER_SIZE,
          color: hexToRgbFloat(m.color),
        })),
    [members],
  );
  // cobe compares marker arrays by reference in `update`, so a content-keyed
  // string is what actually gates re-sending markers to the GPU buffer.
  const markersKey = useMemo(() => JSON.stringify(markers), [markers]);

  // Recompute the target orientation whenever the shared clock moves. Under
  // reduced motion or on mobile there is no running rAF loop (see the next
  // effect) to pick this up on its own, so this effect also does the one
  // discrete re-render itself: "frozen at the orientation for focusInstant"
  // per PLAN.md, not "animation that happens to be very slow."
  useEffect(() => {
    targetPhiRef.current = phiForLongitude(subsolarLongitude(focusInstant));
    if (reducedMotion || isMobile) {
      rotationRef.current.phi = targetPhiRef.current;
      globeRef.current?.update({ phi: rotationRef.current.phi, theta: rotationRef.current.theta });
    }
  }, [focusInstant, reducedMotion, isMobile]);

  // The only place continuous rotation happens. Runs strictly while
  // animation is allowed; reduced motion or mobile means this effect's
  // cleanup fires and no rAF loop exists at all, satisfying "stops
  // entirely" rather than "keeps running but frozen."
  useEffect(() => {
    if (reducedMotion || isMobile) return;
    let frame = requestAnimationFrame(tick);
    function tick() {
      if (!draggingRef.current) {
        rotationRef.current.phi = lerpAngle(rotationRef.current.phi, targetPhiRef.current, EASE_RATE);
        globeRef.current?.update({ phi: rotationRef.current.phi, theta: rotationRef.current.theta });
      }
      frame = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion, isMobile]);

  // Track container width with a ResizeObserver and keep the globe square.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(160, Math.floor(entry.contentRect.width));
      setSizePx(width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Create (once) and destroy the cobe instance. Deliberately does not
  // depend on `members`/`focusInstant`/motion prefs — those flow in via the
  // refs above and via the `globe.update({...})` effects below, so dragging
  // or a clock tick never tears down and rebuilds the WebGL context.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!probeWebglSupport(canvas)) {
      setWebglOk(false);
      return;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = sizePx * dpr;
    canvas.height = sizePx * dpr;

    let globe: Globe | null = null;
    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: dpr,
        width: sizePx * dpr,
        height: sizePx * dpr,
        phi: rotationRef.current.phi,
        theta: rotationRef.current.theta,
        markers,
        ...globeTheme,
      });
      globeRef.current = globe;
    } catch {
      // Belt-and-suspenders: the probe above should catch the WebGL-missing
      // case, but createGlobe touching a detached/mocked canvas (a headless
      // screenshot tool, an unusual embed) is exactly the kind of failure
      // that must not crash the page.
      setWebglOk(false);
      return;
    }

    return () => {
      globe?.destroy();
      globeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // mount-once; see comment above.
  }, [sizePx]);

  // Push marker changes into the running globe without recreating it.
  useEffect(() => {
    globeRef.current?.update({ markers });
  }, [markersKey, markers]);

  // Pointer drag: always live, regardless of reduced-motion, because it is
  // user-initiated rather than ambient animation.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webglOk) return;

    const onPointerDown = (e: PointerEvent) => {
      draggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        phi: rotationRef.current.phi,
        theta: rotationRef.current.theta,
      };
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!draggingRef.current || !start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      rotationRef.current.phi = start.phi + dx / 200;
      rotationRef.current.theta = clamp(start.theta - dy / 200, -THETA_LIMIT, THETA_LIMIT);
      // No rAF loop is guaranteed to be running (reduced motion / mobile
      // turn it off), so a drag must push into cobe directly rather than
      // rely on a loop to pick up the ref next frame.
      globeRef.current?.update({ phi: rotationRef.current.phi, theta: rotationRef.current.theta });
    };
    const endDrag = (e: PointerEvent) => {
      draggingRef.current = false;
      dragStartRef.current = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Already released (e.g. pointercancel after the browser stole
        // capture) — nothing to clean up.
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
    };
  }, [webglOk]);

  const lit = memberStates.filter((s) => s.daylight === true).length;
  const dark = memberStates.filter((s) => s.daylight === false).length;
  const asOf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(focusInstant),
  );
  const summary = `Globe showing member locations as of ${asOf}. ${lit} in daylight, ${dark} in night.`;

  return (
    <div ref={containerRef} className="relative aspect-square w-full">
      {webglOk ? (
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={summary}
          className="h-full w-full touch-none"
          style={{ width: sizePx, height: sizePx, cursor: 'grab' }}
        />
      ) : (
        // No-WebGL fallback: the same member information, rendered visibly
        // rather than into a blank box. This is not the sr-only list below —
        // that list exists even when the canvas renders fine, because a
        // WebGL canvas is invisible to a screen reader either way.
        <div className="slit-frame flex h-full w-full flex-col justify-center gap-2 p-4">
          <p className="meta text-muted">Globe unavailable — showing member times</p>
          <ul className="flex flex-col gap-1">
            {memberStates.map(({ member, localTime, daylight }) => (
              <li key={member.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span style={{ color: member.color }}>{member.name}</span>
                <span className="meta text-muted">
                  {localTime} · {daylightWord(daylight)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The information a WebGL canvas can never expose to a screen reader.
          Present unconditionally — not only in the no-WebGL branch — per
          PLAN.md's accessibility rule: the data must never live only inside
          the canvas. */}
      <ul className="sr-only">
        {memberStates.map(({ member, localTime, daylight }) => (
          <li key={member.id}>
            {member.name}: {localTime} local time, {daylightWord(daylight)}.
          </li>
        ))}
      </ul>
    </div>
  );
}
