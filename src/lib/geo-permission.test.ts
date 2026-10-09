import { afterEach, describe, expect, it, vi } from 'vitest';
import { locationPermission } from './geo-permission';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('locationPermission', () => {
  it('reports what the browser says', async () => {
    for (const state of ['granted', 'prompt', 'denied'] as const) {
      vi.stubGlobal('navigator', { permissions: { query: async () => ({ state }) } });
      await expect(locationPermission()).resolves.toBe(state);
    }
  });

  it('reports unsupported rather than guessing when there is no Permissions API', async () => {
    // Older Safari: the only way to find out is to call getCurrentPosition.
    vi.stubGlobal('navigator', {});
    await expect(locationPermission()).resolves.toBe('unsupported');
  });

  it('reports unsupported when the query itself is rejected', async () => {
    vi.stubGlobal('navigator', {
      permissions: {
        query: async () => {
          throw new TypeError("'geolocation' is not a valid permission name");
        },
      },
    });
    await expect(locationPermission()).resolves.toBe('unsupported');
  });
});
