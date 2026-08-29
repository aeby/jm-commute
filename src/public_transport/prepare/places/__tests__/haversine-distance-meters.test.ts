import { describe, expect, it } from 'vitest';

import { haversineDistanceMeters } from '../haversine-distance-meters';

describe('haversineDistanceMeters', () => {
  it('returns zero for identical coordinates', () => {
    const coordinates = { latitude: 47.378, longitude: 8.54 };

    expect(haversineDistanceMeters(coordinates, coordinates)).toBe(0);
  });

  it('is symmetric', () => {
    const zurich = { latitude: 47.378, longitude: 8.54 };
    const bern = { latitude: 46.948, longitude: 7.4474 };

    expect(haversineDistanceMeters(zurich, bern)).toBeCloseTo(
      haversineDistanceMeters(bern, zurich),
      10,
    );
  });

  it('calculates one degree of latitude as approximately 111.2 km', () => {
    const distance = haversineDistanceMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );

    expect(distance).toBeGreaterThan(111_100);
    expect(distance).toBeLessThan(111_300);
  });

  it('uses latitude and longitude in the correct positions', () => {
    const distance = haversineDistanceMeters(
      { latitude: 60, longitude: 0 },
      { latitude: 60, longitude: 1 },
    );

    expect(distance).toBeGreaterThan(55_500);
    expect(distance).toBeLessThan(55_700);
  });

  it.each([-90.1, 90.1])('rejects invalid latitude %s', (latitude) => {
    expect(() =>
      haversineDistanceMeters(
        { latitude, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toThrow(RangeError);
  });

  it.each([-180.1, 180.1])(
    'rejects invalid longitude %s',
    (longitude) => {
      expect(() =>
        haversineDistanceMeters(
          { latitude: 0, longitude },
          { latitude: 0, longitude: 0 },
        ),
      ).toThrow(RangeError);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects nonfinite coordinate %s',
    (coordinate) => {
      expect(() =>
        haversineDistanceMeters(
          { latitude: 0, longitude: 0 },
          { latitude: coordinate, longitude: 0 },
        ),
      ).toThrow(/finite number/i);

      expect(() =>
        haversineDistanceMeters(
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: coordinate },
        ),
      ).toThrow(/finite number/i);
    },
  );
});
