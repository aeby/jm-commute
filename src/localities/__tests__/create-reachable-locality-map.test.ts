import { describe, expect, it } from 'vitest';

import { createReachableLocalityMap } from '../create-reachable-locality-map';

describe('createReachableLocalityMap', () => {
  it('maps transport-independent locality IDs to travel minutes', () => {
    const reachable = [
      { localityId: '8001:zurich', travelMinutes: 0 },
      { localityId: '3011:bern', travelMinutes: 58 },
    ];

    expect([...createReachableLocalityMap(reachable)]).toEqual([
      ['8001:zurich', 0],
      ['3011:bern', 58],
    ]);
  });

  it('rejects duplicate locality IDs', () => {
    expect(() =>
      createReachableLocalityMap([
        { localityId: '8001:zurich', travelMinutes: 0 },
        { localityId: '8001:zurich', travelMinutes: 10 },
      ]),
    ).toThrow(/duplicate reachable locality/i);
  });
});
