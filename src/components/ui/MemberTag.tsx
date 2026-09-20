/** The six member tints from PLAN.md section 6. `--pulse` is reserved for
 *  the overlap and is deliberately absent from this list — a caller cannot
 *  accidentally hand it to a member. */
export const MEMBER_TINTS = [
  'ice',
  'brass',
  'mint',
  'orchid',
  'clay',
  'steel',
] as const;

export type MemberTint = (typeof MEMBER_TINTS)[number];

/** Stable tint assignment from an id, so a member keeps the same colour
 *  across renders/reloads without the caller having to persist an index. */
export function tintForId(id: string): MemberTint {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % MEMBER_TINTS.length;
  // noUncheckedIndexedAccess: the modulo guarantees this index is in range,
  // but the type system can't see that, so assert with a fallback rather
  // than a non-null `!`.
  return MEMBER_TINTS[index] ?? 'ice';
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase().slice(0, 2).padEnd(2, first.toUpperCase() || '?');
}

/**
 * Two-letter uppercase mono tag + tint colour. Identity must never depend
 * on colour alone (colour-blind members, greyscale screenshots), so the
 * tag is always rendered alongside the tint — never the tint by itself.
 */
export function MemberTag({
  name,
  tint,
  className = '',
}: {
  name: string;
  tint: MemberTint;
  className?: string;
}) {
  return (
    <span
      className={`meta inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 text-[11px] leading-none ${className}`}
      style={{
        color: `var(--tint-${tint})`,
        borderColor: `var(--tint-${tint})`,
        border: '1px solid',
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}
