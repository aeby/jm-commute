import { describe, expect, it } from 'vitest';

import { VIEWER_CONFIG } from '../config';

describe('commute viewer map presentation', () => {
  it('uses the token-free OpenFreeMap Positron style', () => {
    expect(VIEWER_CONFIG.map.styleUrl).toBe(
      'https://tiles.openfreemap.org/styles/positron',
    );
  });

  it('renders logical hex cells at an 88% visual scale', () => {
    expect(VIEWER_CONFIG.visualization.hexRenderScale).toBe(0.88);
  });
});
