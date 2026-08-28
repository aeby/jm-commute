import { describe, expect, it } from 'vitest';

import { isPreferredFastestJourney } from '../fastest-journey-policy';

describe('isPreferredFastestJourney', () => {
  it('prefers a shorter duration', () => {
    expect(
      isPreferredFastestJourney(1_799, 28_000, 29_799, 1_800, 29_000, 30_800),
    ).toBe(true);
  });

  it('prefers a later departure when durations are equal', () => {
    expect(
      isPreferredFastestJourney(1_800, 29_000, 30_800, 1_800, 28_000, 29_800),
    ).toBe(true);
  });

  it('prefers an earlier arrival after duration and departure tie', () => {
    expect(
      isPreferredFastestJourney(1_800, 29_000, 30_799, 1_800, 29_000, 30_800),
    ).toBe(true);
  });

  it('does not replace an identical or preferred existing journey', () => {
    expect(
      isPreferredFastestJourney(1_800, 29_000, 30_800, 1_800, 29_000, 30_800),
    ).toBe(false);
    expect(
      isPreferredFastestJourney(1_801, 29_001, 30_802, 1_800, 29_000, 30_800),
    ).toBe(false);
  });
});
