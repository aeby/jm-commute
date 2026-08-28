import { describe, expect, it, vi } from 'vitest';

import type { ReachableLocality } from '@jm/commute';
import {
  createTransitTravelTimeMatrixRowGenerator,
  type TransitReachabilityQuery,
} from '../travel-time-matrix-row';

const LOCALITY_IDS = [
  '1000:alpha',
  '2000:beta',
  '3000:gamma',
  '4000:delta',
] as const;

describe('transit travel-time matrix rows', () => {
  it('requires nonempty, unique, lexically ordered locality IDs', () => {
    expect(() =>
      createTransitTravelTimeMatrixRowGenerator(
        [LOCALITY_IDS[0], LOCALITY_IDS[0]],
        () => [],
      ),
    ).toThrow('Duplicate transit matrix locality');
    expect(() =>
      createTransitTravelTimeMatrixRowGenerator([], () => []),
    ).toThrow('must not be empty');
    expect(() =>
      createTransitTravelTimeMatrixRowGenerator(
        [LOCALITY_IDS[1], LOCALITY_IDS[0]],
        () => [],
      ),
    ).toThrow('deterministic lexical order');
  });

  it('defaults the exact row to unavailable and populates whole-minute results', () => {
    const query = vi.fn<TransitReachabilityQuery>(() => [
      { localityId: LOCALITY_IDS[2], travelMinutes: 240 },
      { localityId: LOCALITY_IDS[0], travelMinutes: 30 },
      { localityId: LOCALITY_IDS[1], travelMinutes: 9 },
    ]);
    const generator = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      query,
    );

    expect([...generator.generateRow(1)]).toEqual([30, 0, 240, 255]);
    expect(query).toHaveBeenCalledExactlyOnceWith(LOCALITY_IDS[1], 240);
  });

  it('creates a self-only row when the compiler query finds no destinations', () => {
    const query = vi.fn<TransitReachabilityQuery>(() => []);
    const generator = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      query,
    );

    expect([...generator.generateRow(2)]).toEqual([255, 255, 0, 255]);
    expect(query).toHaveBeenCalledExactlyOnceWith(LOCALITY_IDS[2], 240);
  });

  it('retains the 240-minute boundary and rejects results beyond it', () => {
    const valid = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      () => [{ localityId: LOCALITY_IDS[3], travelMinutes: 240 }],
    );
    expect(valid.generateRow(0)[3]).toBe(240);

    for (const travelMinutes of [241, 255, -1, 30.5, Number.NaN]) {
      const invalid = createTransitTravelTimeMatrixRowGenerator(
        LOCALITY_IDS,
        () => [{ localityId: LOCALITY_IDS[3], travelMinutes }],
      );
      expect(() => invalid.generateRow(0)).toThrow(
        'travelMinutes must be an integer from 0 to 240',
      );
    }
  });

  it('produces identical bytes regardless of reachable-result order', () => {
    const results: readonly ReachableLocality[] = [
      { localityId: LOCALITY_IDS[1], travelMinutes: 12 },
      { localityId: LOCALITY_IDS[3], travelMinutes: 70 },
      { localityId: LOCALITY_IDS[0], travelMinutes: 0 },
    ];
    const forward = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      () => results,
    );
    const reverse = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      () => results.toReversed(),
    );

    expect(forward.generateRow(0)).toEqual(reverse.generateRow(0));
  });

  it('rejects unknown, duplicate, and malformed reachable results', () => {
    for (const results of [
      [{ localityId: '9999:unknown', travelMinutes: 1 }],
      [
        { localityId: LOCALITY_IDS[1], travelMinutes: 1 },
        { localityId: LOCALITY_IDS[1], travelMinutes: 2 },
      ],
    ]) {
      const generator = createTransitTravelTimeMatrixRowGenerator(
        LOCALITY_IDS,
        () => results,
      );
      expect(() => generator.generateRow(0)).toThrow(
        'Invalid transit reachability result',
      );
    }

    const malformedQuery = (() => undefined) as unknown as TransitReachabilityQuery;
    const malformed = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      malformedQuery,
    );
    expect(() => malformed.generateRow(0)).toThrow('expected an array');
  });

  it('rejects invalid row requests', () => {
    const generator = createTransitTravelTimeMatrixRowGenerator(
      LOCALITY_IDS,
      () => [],
    );
    expect(() => generator.generateRow(-1)).toThrow('origin index');
    expect(() => generator.generateRow(LOCALITY_IDS.length)).toThrow(
      'origin index',
    );
  });
});
