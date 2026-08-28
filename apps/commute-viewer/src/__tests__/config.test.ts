import { describe, expect, it } from 'vitest';

import { VIEWER_CONFIG } from '../config';

describe('commute viewer map presentation', () => {
  it('uses the token-free OpenFreeMap Positron style', () => {
    expect(VIEWER_CONFIG.map.styleUrl).toBe(
      'https://tiles.openfreemap.org/styles/positron',
    );
  });

  it('uses the local commute API and complete four-hour viewer horizon', () => {
    expect(VIEWER_CONFIG.api.baseUrl).toBe('http://127.0.0.1:3001');
    expect(VIEWER_CONFIG.commute).toEqual({
      minimumMinutes: 15,
      maximumMinutes: 240,
      defaultMinutes: 60,
      stepMinutes: 5,
    });
  });
});
