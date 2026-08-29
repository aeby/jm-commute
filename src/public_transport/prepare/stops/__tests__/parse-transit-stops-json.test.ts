import { describe, expect, it } from 'vitest';

import { parseTransitStopsJson } from '../parse-transit-stops-json';

const SOURCE = 'fixture transit-stops.json';
const VALID_STOP = {
  id: 'stop-1',
  name: 'Example Stop',
  latitude: 47.1,
  longitude: 8.2,
  kind: 'STOP_OR_PLATFORM',
} as const;

describe('parseTransitStopsJson', () => {
  it('parses routing fields and ignores legacy stop names', () => {
    const station = {
      id: 'station-1',
      name: 'Example Station',
      latitude: 47,
      longitude: 8,
      kind: 'STATION',
    } as const;
    const child = {
      ...VALID_STOP,
      parentStationId: station.id,
    };

    expect(
      parseTransitStopsJson(JSON.stringify([station, child]), SOURCE),
    ).toEqual([
      {
        id: 'station-1',
        latitude: 47,
        longitude: 8,
        kind: 'STATION',
      },
      {
        id: 'stop-1',
        latitude: 47.1,
        longitude: 8.2,
        kind: 'STOP_OR_PLATFORM',
        parentStationId: 'station-1',
      },
    ]);
  });

  it('reports malformed JSON with source context', () => {
    expect(() => parseTransitStopsJson('{', SOURCE)).toThrow(
      /unable to parse fixture transit-stops\.json as JSON/i,
    );
  });

  it('requires an array root', () => {
    expect(() => parseTransitStopsJson('{}', SOURCE)).toThrow(
      /fixture transit-stops\.json must contain a JSON array/i,
    );
  });

  it.each([
    ['id', { ...VALID_STOP, id: ' ' }],
    ['latitude', { ...VALID_STOP, latitude: Number.NaN }],
    ['longitude', { ...VALID_STOP, longitude: Number.POSITIVE_INFINITY }],
    ['kind', { ...VALID_STOP, kind: 'ENTRANCE' }],
    ['parentStationId', { ...VALID_STOP, parentStationId: ' ' }],
  ])('rejects an invalid %s with source and entry context', (_, entry) => {
    expect(() =>
      parseTransitStopsJson(JSON.stringify([entry]), SOURCE),
    ).toThrow(/index 0 in fixture transit-stops\.json/i);
  });

  it('rejects duplicate transit-stop IDs', () => {
    expect(() =>
      parseTransitStopsJson(
        JSON.stringify([VALID_STOP, { ...VALID_STOP }]),
        SOURCE,
      ),
    ).toThrow(/duplicate "id" "stop-1"/i);
  });
});
