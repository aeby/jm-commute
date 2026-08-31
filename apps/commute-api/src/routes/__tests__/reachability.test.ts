import { describe, expect, it } from 'vitest';

import type { Locality } from '@jm/commute';

import type { CommuteApiRuntime } from '../../api-types.js';
import { parseReachabilityRequest } from '../reachability.js';

const zurich: Locality = {
  localityId: '8001:zurich',
  postalCode: '8001',
  city: 'Zürich',
  latitude: 47.372_309,
  longitude: 8.542_467,
};

const runtime: Pick<CommuteApiRuntime, 'resolve'> = {
  resolve: (query) =>
    query === zurich.localityId ? zurich : undefined,
};

describe('parseReachabilityRequest', () => {
  it.each([0, 240])('accepts the dataset threshold boundary %i', (maximum) => {
    expect(
      parseReachabilityRequest(
        {
          originLocalityId: '8001:zurich',
          mode: 'road',
          maxTravelMinutes: maximum,
        },
        runtime,
      ),
    ).toEqual({
      originLocalityId: '8001:zurich',
      mode: 'road',
      maxTravelMinutes: maximum,
    });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite threshold %s before runtime dispatch',
    (maximum) => {
      expect(() =>
        parseReachabilityRequest(
          {
            originLocalityId: '8001:zurich',
            mode: 'public_transport',
            maxTravelMinutes: maximum,
          },
          runtime,
        ),
      ).toThrow('maxTravelMinutes must be an integer between 0 and 240');
    },
  );
});
