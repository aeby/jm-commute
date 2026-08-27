import { describe, expect, it } from 'vitest';

import { isRailRouteType } from '../is-rail-route-type';

describe('isRailRouteType', () => {
  it('recognizes standard GTFS railway route type 2', () => {
    expect(isRailRouteType(2)).toBe(true);
  });

  it('recognizes the complete extended railway range', () => {
    expect(isRailRouteType(100)).toBe(true);
    expect(isRailRouteType(199)).toBe(true);
    expect(isRailRouteType(99)).toBe(false);
    expect(isRailRouteType(200)).toBe(false);
  });

  it.each([102, 103, 106, 109])(
    'recognizes Swiss railway route type %s',
    (routeType) => {
      expect(isRailRouteType(routeType)).toBe(true);
    },
  );

  it('does not classify bus route type 700 as railway', () => {
    expect(isRailRouteType(700)).toBe(false);
  });
});
