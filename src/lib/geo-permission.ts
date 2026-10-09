/**
 * Whether the browser will let us ask for a location, kept apart from
 * `geo-timezone.ts` on purpose: that module carries a 90KB boundary table,
 * and the join page needs to know which control to render before it knows
 * whether anyone will press it. This file has no dependencies, so the probe
 * costs nothing and the table loads only on a real detection.
 */

/**
 * What the browser will do if `detectByLocation` is called right now.
 *
 * `prompt` means a click can raise the permission dialog; `granted` means a
 * reading is free and silent; `denied` means calling again shows the member
 * nothing at all, so the UI must stop asking rather than appear broken.
 * `unsupported` covers browsers without the Permissions API (older Safari),
 * where the only way to find out is to try.
 */
export async function locationPermission(): Promise<PermissionState | 'unsupported'> {
  const permissions = globalThis.navigator?.permissions;
  if (!permissions?.query) return 'unsupported';
  try {
    const status = await permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'unsupported';
  }
}
