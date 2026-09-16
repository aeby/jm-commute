import { describe, expect, it } from 'vitest';
import type { Locality } from '@jobmate/commute';
import { buildLocalityRoutingIndex } from '../build-locality-routing-index';
import type { ActiveTransitPlace } from '../collect-active-transit-places';

const ORIGIN: Locality = {
  localityId: '8001:zurich', postalCode: '8001', city: 'Zürich',
  latitude: 0, longitude: 0,
};
const OPTIONS = { preferredRadiusMeters: 500, railDepartureBoostPercent: 25 };
const place = (
  id: string, distanceMeters: number, departureCount: number, railDepartureCount = 0,
): ActiveTransitPlace => ({
  id, name: id, latitude: distanceMeters / 6_371_008.8 * 180 / Math.PI, longitude: 0,
  stopIds: [id], departureCount, railDepartureCount,
});
const selected = (
  places: readonly ActiveTransitPlace[], options = OPTIONS,
): string | undefined => {
  const indexes = new Map(places.map(({ id }, index) => [id, index]));
  const entry = buildLocalityRoutingIndex([ORIGIN], places, indexes, options).entries[0]!;
  return entry.stopIndexes.length ? places[entry.stopIndexes[0]!]!.id : undefined;
};

describe('buildLocalityRoutingIndex', () => {
  it('records the selected station name for both scoring and nearest fallback', () => {
    const places = [
      { ...place('near', 100, 5), name: 'Nearby bus stop' },
      { ...place('busy', 400, 20), name: 'Selected station' },
    ];
    const indexes = new Map([['near', 0], ['busy', 1]]);
    expect(buildLocalityRoutingIndex([ORIGIN], places, indexes, OPTIONS).entries[0])
      .toMatchObject({ stationName: 'Selected station', stopIndexes: Uint32Array.of(1) });
    expect(buildLocalityRoutingIndex([ORIGIN], places, indexes, {
      ...OPTIONS, preferredRadiusMeters: 0,
    }).entries[0]).toMatchObject({ stationName: 'Nearby bus stop', stopIndexes: Uint32Array.of(0) });
  });

  it('prefers more usable service within the radius over a closer stop', () => {
    expect(selected([place('near', 100, 5), place('busy', 400, 20)])).toBe('busy');
  });

  it('gives rail a configurable modest bonus without overriding a busy bus stop', () => {
    const bus = place('bus', 100, 20);
    const rail = place('rail', 300, 18, 18);
    expect(selected([bus, rail])).toBe('rail');
    expect(selected([bus, rail], { ...OPTIONS, railDepartureBoostPercent: 0 })).toBe('bus');
    expect(selected([{ ...bus, departureCount: 30 }, rail])).toBe('bus');
    expect(selected([{ ...bus, departureCount: 30 }, rail], {
      ...OPTIONS, railDepartureBoostPercent: 100,
    })).toBe('rail');
  });

  it('boosts only rail departures at a mixed station', () => {
    expect(selected([place('bus', 100, 23), place('mixed', 300, 20, 1)])).toBe('bus');
  });

  it('uses distance then station ID for tied scores regardless of input order', () => {
    const places = [place('z', 300, 20), place('b', 100, 20), place('a', 100, 20)];
    expect(selected(places)).toBe('a');
    expect(selected(places.toReversed())).toBe('a');
  });

  it('uses the configurable inclusive radius and excludes even a busy station beyond it', () => {
    const places = [place('bus', 100, 10), place('rail', 500, 20, 20)];
    expect(selected(places)).toBe('rail');
    expect(selected(places, { ...OPTIONS, preferredRadiusMeters: 400 })).toBe('bus');
    expect(selected([place('at-origin', 0, 1), place('nearby', 1, 100)], {
      ...OPTIONS, preferredRadiusMeters: 0,
    })).toBe('at-origin');
  });

  it('falls back to the nearest active station without a distance cap or score preference', () => {
    const places = [place('near', 5_000, 1), place('rail', 5_100, 100, 100)];
    expect(selected(places)).toBe('near');
    expect(selected([place('z', 5_000, 50), place('a', 5_000, 1)])).toBe('a');
  });

  it('keeps an unavailable entry when there are no active stations', () => {
    expect(buildLocalityRoutingIndex([ORIGIN], [], new Map(), OPTIONS).entries).toEqual([
      { localityId: ORIGIN.localityId, stopIndexes: new Uint32Array() },
    ]);
  });

  it('resolves all selected platforms to unique sorted indexes and sorts localities', () => {
    const station = { ...place('station', 0, 10), stopIds: ['c', 'inactive', 'a', 'c'] };
    const bern = { ...ORIGIN, localityId: '3011:bern' as Locality['localityId'] };
    expect(buildLocalityRoutingIndex([ORIGIN, bern], [station], new Map([
      ['a', 2], ['c', 0],
    ]), OPTIONS).entries).toEqual([
      { localityId: '3011:bern', stationName: 'station', stopIndexes: Uint32Array.of(0, 2) },
      { localityId: ORIGIN.localityId, stationName: 'station', stopIndexes: Uint32Array.of(0, 2) },
    ]);
  });

  it('rejects duplicate localities and invalid dense stop indexes', () => {
    expect(() => buildLocalityRoutingIndex([ORIGIN, ORIGIN], [], new Map(), OPTIONS))
      .toThrow(/duplicate/i);
    expect(() => buildLocalityRoutingIndex([ORIGIN], [place('bad', 0, 1)],
      new Map([['bad', -1]]), OPTIONS)).toThrow(/Uint32/i);
  });

  it.each(['preferredRadiusMeters', 'railDepartureBoostPercent'] as const)(
    'rejects invalid %s', (key) => {
      for (const value of [-1, NaN, Infinity]) {
        expect(() => selected([], { ...OPTIONS, [key]: value })).toThrow(/finite nonnegative/i);
      }
    },
  );
});
