import { describe, expect, it } from 'vitest';

import fixtureCsv from './fixtures/stops.txt?raw';
import { parseGtfsStops } from '../parse-gtfs-stops';

const REQUIRED_HEADERS = [
  'stop_id',
  'stop_name',
  'stop_lat',
  'stop_lon',
  'location_type',
  'parent_station',
] as const;

function createCsv(...rows: readonly string[]): string {
  return [REQUIRED_HEADERS.join(','), ...rows].join('\n');
}

describe('parseGtfsStops', () => {
  it('maps, trims, and sorts included GTFS locations', () => {
    expect(parseGtfsStops(fixtureCsv)).toEqual([
      {
        id: '000123',
        name: 'Bern, Bärenplatz',
        latitude: 46.948,
        longitude: 7.4474,
        kind: 'STOP',
      },
      {
        id: 'platform-zurich-1',
        name: 'Zürich HB',
        latitude: 47.3781,
        longitude: 8.5401,
        kind: 'STOP',
        parentId: 'station-zurich',
      },
      {
        id: 'platform-zurich-2',
        name: 'Zürich HB',
        latitude: 47.3782,
        longitude: 8.5402,
        kind: 'STOP',
        parentId: 'station-zurich',
      },
      {
        id: 'station-zurich',
        name: 'Zürich HB',
        latitude: 47.378,
        longitude: 8.54,
        kind: 'STATION',
      },
    ]);
  });

  it('keeps IDs as strings, including leading zeroes', () => {
    const [location] = parseGtfsStops(fixtureCsv);

    expect(location?.id).toBe('000123');
    expect(typeof location?.id).toBe('string');
  });

  it('maps an empty location_type to STOP', () => {
    const location = parseGtfsStops(fixtureCsv).find(
      ({ id }) => id === 'platform-zurich-1',
    );

    expect(location?.kind).toBe('STOP');
  });

  it('maps location_type 0 to STOP and location_type 1 to STATION', () => {
    const locations = parseGtfsStops(fixtureCsv);

    expect(locations.find(({ id }) => id === 'platform-zurich-2')?.kind).toBe(
      'STOP',
    );
    expect(locations.find(({ id }) => id === 'station-zurich')?.kind).toBe(
      'STATION',
    );
  });

  it('maps parent_station and accepts a standalone stop', () => {
    const locations = parseGtfsStops(fixtureCsv);

    expect(
      locations.find(({ id }) => id === 'platform-zurich-1')?.parentId,
    ).toBe('station-zurich');
    expect(locations.find(({ id }) => id === '000123')).not.toHaveProperty(
      'parentId',
    );
  });

  it('ignores entrances, internal nodes, and boarding areas', () => {
    const ids = parseGtfsStops(fixtureCsv).map(({ id }) => id);

    expect(ids).not.toContain('entrance-zurich');
    expect(ids).not.toContain('node-zurich');
    expect(ids).not.toContain('boarding-zurich');
  });

  it('parses quoted names containing commas', () => {
    expect(parseGtfsStops(fixtureCsv)[0]?.name).toBe('Bern, Bärenplatz');
  });

  it('supports a UTF-8 BOM and CRLF line endings', () => {
    const bomAndCrlfCsv = `\uFEFF${fixtureCsv.replace(/\r?\n/g, '\r\n')}`;

    expect(parseGtfsStops(bomAndCrlfCsv)).toEqual(
      parseGtfsStops(fixtureCsv),
    );
  });

  it('returns results in deterministic ID order', () => {
    expect(parseGtfsStops(fixtureCsv).map(({ id }) => id)).toEqual([
      '000123',
      'platform-zurich-1',
      'platform-zurich-2',
      'station-zurich',
    ]);
  });

  it.each(REQUIRED_HEADERS)(
    'reports a missing required %s header',
    (missingHeader) => {
      const headers = REQUIRED_HEADERS.filter(
        (header) => header !== missingHeader,
      );
      const csv = `${headers.join(',')}\n${headers.map(() => 'value').join(',')}`;

      expect(() => parseGtfsStops(csv)).toThrowError(
        new RegExp(`missing required column.*${missingHeader}`, 'i'),
      );
    },
  );

  it.each([
    ['stop_lat', '', '8.54'],
    ['stop_lat', 'NaN', '8.54'],
    ['stop_lat', 'Infinity', '8.54'],
    ['stop_lat', '91', '8.54'],
    ['stop_lon', '47.37', ''],
    ['stop_lon', '47.37', 'Infinity'],
    ['stop_lon', '47.37', '-181'],
  ])(
    'reports an invalid %s coordinate',
    (column, latitude, longitude) => {
      const csv = createCsv(
        `location,Location,${latitude},${longitude},0,`,
      );

      expect(() => parseGtfsStops(csv)).toThrowError(
        new RegExp(
          column === 'stop_lat'
            ? '(missing required field|invalid).*stop_lat'
            : '(missing required field|invalid).*stop_lon',
          'i',
        ),
      );
    },
  );

  it.each([
    ['stop_id', ' ,Location,47.37,8.54,0,'],
    ['stop_name', 'location,   ,47.37,8.54,0,'],
  ])('reports a blank required %s field', (field, row) => {
    expect(() => parseGtfsStops(createCsv(row))).toThrowError(
      new RegExp(`missing required field.*${field}`, 'i'),
    );
  });

  it('rejects duplicate trimmed stop IDs', () => {
    const csv = createCsv(
      'duplicate,First,47.37,8.54,0,',
      ' duplicate ,Second,47.38,8.55,0,',
    );

    expect(() => parseGtfsStops(csv)).toThrowError(
      /duplicate stop_id "duplicate".*first seen at row/i,
    );
  });

  it('rejects a missing parent station', () => {
    const csv = createCsv(
      'child,Child platform,47.37,8.54,0,missing-station',
    );

    expect(() => parseGtfsStops(csv)).toThrowError(
      /stop "child" references missing parent station "missing-station"/i,
    );
  });

  it('rejects a parent that is not a station', () => {
    const csv = createCsv(
      'parent-stop,Parent stop,47.37,8.54,0,',
      'child,Child platform,47.38,8.55,0,parent-stop',
    );

    expect(() => parseGtfsStops(csv)).toThrowError(
      /stop "child" references "parent-stop".*not a station/i,
    );
  });

  it('rejects a station with a parent', () => {
    const csv = createCsv(
      'station,Station,47.37,8.54,1,parent-station',
    );

    expect(() => parseGtfsStops(csv)).toThrowError(
      /station "station" must not have parent station "parent-station"/i,
    );
  });

  it.each(['5', '-1', 'unknown'])(
    'rejects unknown location_type %j',
    (locationType) => {
      const csv = createCsv(
        `location,Location,47.37,8.54,${locationType},`,
      );

      expect(() => parseGtfsStops(csv)).toThrowError(
        new RegExp(`unknown.*location_type.*${locationType}`, 'i'),
      );
    },
  );

  it('does not validate fields belonging to ignored location types', () => {
    const csv = createCsv(
      'entrance,,not-a-latitude,not-a-longitude,2,missing-parent',
      'node,,not-a-latitude,not-a-longitude,3,missing-parent',
      'boarding,,not-a-latitude,not-a-longitude,4,missing-parent',
    );

    expect(parseGtfsStops(csv)).toEqual([]);
  });
});
