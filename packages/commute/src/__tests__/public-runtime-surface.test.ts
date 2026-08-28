import { describe, expect, expectTypeOf, it } from 'vitest';

import * as commuteRuntime from '../index.js';
import type { ReachableLocality } from '../index.js';

describe('@jm/commute public runtime surface', () => {
  it('exposes only the deliberate platform-neutral runtime API', () => {
    expect(Object.keys(commuteRuntime).toSorted()).toEqual([
      'COMMUTE_MATRIX_MAX_TRAVEL_MINUTES',
      'LocalityResolver',
      'createCarTravelTimeIndex',
      'createLocalityCatalog',
      'createLocalityId',
      'createTransitTravelTimeIndex',
      'getCarTravelMinutes',
      'getReachableLocalitiesByCar',
      'getReachableLocalitiesByTransit',
      'getTransitTravelMinutes',
      'normalizeCityName',
    ]);
  });

  it('uses the shared locality result contract for both transports', () => {
    type CarResult = ReturnType<
      typeof commuteRuntime.getReachableLocalitiesByCar
    >;
    type TransitResult = ReturnType<
      typeof commuteRuntime.getReachableLocalitiesByTransit
    >;

    expectTypeOf<CarResult>().toEqualTypeOf<readonly ReachableLocality[]>();
    expectTypeOf<TransitResult>().toEqualTypeOf<
      readonly ReachableLocality[]
    >();
  });
});
