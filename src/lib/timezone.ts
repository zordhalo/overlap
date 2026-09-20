/**
 * Canonical IANA timezone validation.
 *
 * `Intl.supportedValuesOf('timeZone')` is the obvious check and it is wrong for
 * this. It returns only the zones ICU enumerates — 418 on the Node build this
 * was written against — using *deprecated* names while omitting the modern
 * canonical ones. Measured, not assumed:
 *
 *   Asia/Kolkata    omitted   Asia/Calcutta   present
 *   Europe/Kyiv     omitted   Europe/Kiev     present
 *   Asia/Kathmandu  omitted
 *   America/Indiana/Indianapolis  omitted
 *
 * Validating against that list rejects real people: anyone in India or Nepal
 * could not join a circle, and `Europe/Kyiv` would be refused while the
 * superseded `Europe/Kiev` was accepted.
 *
 * `Intl.DateTimeFormat` resolves every one of those, including links and
 * aliases, so the constructor is the authority. Asking the runtime whether it
 * can actually use a zone beats asking whether the zone appears in a list the
 * runtime happens to advertise.
 */

/** True when the runtime can actually resolve this zone. */
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  // A bare offset or a locale-ish string would be accepted by some engines;
  // require the Region/City shape (or UTC) so input stays a real IANA id.
  if (value !== 'UTC' && !/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimezone(value: unknown, label = 'timezone'): string {
  if (!isValidTimezone(value)) {
    throw new Error(`${label} must be a resolvable IANA timezone, got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Every zone worth offering in a picker: what ICU enumerates, plus the modern
 * canonical names it omits. Sorted, deduplicated.
 */
export function selectableTimezones(): string[] {
  const enumerated = Intl.supportedValuesOf('timeZone');
  const canonicalOmissions = [
    'Asia/Kolkata', 'Europe/Kyiv', 'Asia/Kathmandu', 'Asia/Ho_Chi_Minh',
    'America/Argentina/Buenos_Aires', 'America/Indiana/Indianapolis',
    'Africa/Asmara', 'Asia/Yangon', 'Pacific/Chuuk', 'Pacific/Pohnpei',
    'Atlantic/Faroe', 'America/Nuuk',
  ].filter(isValidTimezone);
  return [...new Set([...enumerated, ...canonicalOmissions])].sort();
}
