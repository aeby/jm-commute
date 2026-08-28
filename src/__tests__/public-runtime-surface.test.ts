import { describe, expect, expectTypeOf, it } from 'vitest';

import * as carRuntime from '../car';
import * as localityDomain from '../localities';
import type { ReachableLocality } from '../localities';
import * as transitRuntime from '../transit';

describe('canonical public runtime surfaces', () => {
  it('exposes only transport-independent locality operations', () => {
    expect(Object.keys(localityDomain).toSorted()).toEqual([
      'LocalityResolver',
      'createLocalityId',
      'normalizeCityName',
    ]);
  });

  it('exposes only opaque car creation and high-level queries', () => {
    expect(Object.keys(carRuntime).toSorted()).toEqual([
      'createCarTravelTimeIndex',
      'getCarTravelMinutes',
      'getReachableLocalitiesByCar',
    ]);
  });

  it('keeps the transit root at the opaque high-level query boundary', () => {
    expect(Object.keys(transitRuntime)).toEqual([
      'getReachableLocalitiesByTransit',
    ]);
  });

  it('uses the shared locality result contract for both transports', () => {
    type CarResult = ReturnType<
      typeof carRuntime.getReachableLocalitiesByCar
    >;
    type TransitResult = ReturnType<
      typeof transitRuntime.getReachableLocalitiesByTransit
    >;

    expectTypeOf<CarResult>().toEqualTypeOf<readonly ReachableLocality[]>();
    expectTypeOf<TransitResult>().toEqualTypeOf<
      readonly ReachableLocality[]
    >();
  });
});
