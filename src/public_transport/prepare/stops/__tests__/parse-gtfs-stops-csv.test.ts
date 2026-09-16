import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parseGtfsStopsCsv } from '..';

const fixtureCsv = readFileSync(
  new URL('./fixtures/stops.txt', import.meta.url),
  'utf8',
);

const CSV_HEADERS = [
  'stop_id',
  'stop_name',
  'stop_lat',
  'stop_lon',
  'location_type',
  'parent_station',
] as const;

function createCsv(...rows: readonly string[]): string {
  return [CSV_HEADERS.join(','), ...rows].join('\n');
}

describe('parseGtfsStopsCsv', () => {
  it('maps, trims, and sorts retained GTFS stops', () => {
    expect(parseGtfsStopsCsv(fixtureCsv)).toEqual([
      {
        id: '000123',
        name: 'Bern, Bärenplatz',
        latitude: 46.948,
        longitude: 7.4474,
        kind: 'STOP_OR_PLATFORM',
      },
      {
        id: 'Parentch:1:sloid:7000',
        name: 'Zürich HB',
        latitude: 47.378,
        longitude: 8.54,
        kind: 'STATION',
      },
      {
        id: 'ch:1:sloid:7000:0:1',
        name: 'Zürich HB',
        latitude: 47.3781,
        longitude: 8.5401,
        kind: 'STOP_OR_PLATFORM',
        parentStationId: 'Parentch:1:sloid:7000',
      },
      {
        id: 'ch:1:sloid:7000:0:2',
        name: 'Zürich HB',
        latitude: 47.3782,
        longitude: 8.5402,
        kind: 'STOP_OR_PLATFORM',
        parentStationId: 'Parentch:1:sloid:7000',
      },
    ]);
  });

  it('keeps IDs as strings, including leading zeroes', () => {
    const [stop] = parseGtfsStopsCsv(fixtureCsv);

    expect(stop?.id).toBe('000123');
    expect(typeof stop?.id).toBe('string');
  });

  it('preserves long nonnumeric IDs and parent IDs unchanged', () => {
    const stop = parseGtfsStopsCsv(fixtureCsv).find(
      ({ id }) => id === 'ch:1:sloid:7000:0:1',
    );

    expect(stop?.id).toBe('ch:1:sloid:7000:0:1');
    expect(stop?.parentStationId).toBe('Parentch:1:sloid:7000');
    expect(typeof stop?.parentStationId).toBe('string');
  });

  it('maps an empty location_type to STOP_OR_PLATFORM', () => {
    const stop = parseGtfsStopsCsv(fixtureCsv).find(
      ({ id }) => id === 'ch:1:sloid:7000:0:1',
    );

    expect(stop?.kind).toBe('STOP_OR_PLATFORM');
  });

  it('maps location_type 0 to STOP_OR_PLATFORM and 1 to STATION', () => {
    const stops = parseGtfsStopsCsv(fixtureCsv);

    expect(
      stops.find(({ id }) => id === 'ch:1:sloid:7000:0:2')?.kind,
    ).toBe('STOP_OR_PLATFORM');
    expect(
      stops.find(({ id }) => id === 'Parentch:1:sloid:7000')?.kind,
    ).toBe('STATION');
  });

  it('preserves parent_station and accepts a standalone stop', () => {
    const stops = parseGtfsStopsCsv(fixtureCsv);

    expect(
      stops.find(({ id }) => id === 'ch:1:sloid:7000:0:1')
        ?.parentStationId,
    ).toBe('Parentch:1:sloid:7000');
    expect(stops.find(({ id }) => id === '000123')).not.toHaveProperty(
      'parentStationId',
    );
  });

  it('ignores entrances, internal nodes, and boarding areas', () => {
    const ids = parseGtfsStopsCsv(fixtureCsv).map(({ id }) => id);

    expect(ids).not.toContain('entrance-zurich');
    expect(ids).not.toContain('node-zurich');
    expect(ids).not.toContain('boarding-zurich');
  });

  it('supports a UTF-8 BOM and CRLF line endings', () => {
    const bomAndCrlfCsv = `\uFEFF${fixtureCsv.replace(/\r?\n/g, '\r\n')}`;

    expect(parseGtfsStopsCsv(bomAndCrlfCsv)).toEqual(
      parseGtfsStopsCsv(fixtureCsv),
    );
  });

  it('returns results in deterministic ID order', () => {
    expect(parseGtfsStopsCsv(fixtureCsv).map(({ id }) => id)).toEqual([
      '000123',
      'Parentch:1:sloid:7000',
      'ch:1:sloid:7000:0:1',
      'ch:1:sloid:7000:0:2',
    ]);
  });

  it.each(CSV_HEADERS)(
    'reports a missing required %s header',
    (missingHeader) => {
      const headers = CSV_HEADERS.filter(
        (header) => header !== missingHeader,
      );
      const csv = `${headers.join(',')}\n${headers.map(() => 'value').join(',')}`;

      expect(() => parseGtfsStopsCsv(csv)).toThrow(
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

      expect(() => parseGtfsStopsCsv(csv)).toThrow(
        new RegExp(
          column === 'stop_lat'
            ? '(missing required field|invalid).*stop_lat'
            : '(missing required field|invalid).*stop_lon',
          'i',
        ),
      );
    },
  );

  it('reports a blank required stop_id field', () => {
    expect(() =>
      parseGtfsStopsCsv(createCsv(' ,Location,47.37,8.54,0,')),
    ).toThrow(/missing required field.*stop_id/i);
  });

  it('reports a blank required stop_name field', () => {
    expect(() =>
      parseGtfsStopsCsv(createCsv('location, ,47.37,8.54,0,')),
    ).toThrow(/missing required field.*stop_name/i);
  });

  it('rejects duplicate stop IDs', () => {
    const csv = createCsv(
      'duplicate,First,47.37,8.54,0,',
      'duplicate,Second,47.38,8.55,0,',
    );

    expect(() => parseGtfsStopsCsv(csv)).toThrow(
      /duplicate stop_id "duplicate".*first seen at row/i,
    );
  });

  it('rejects a missing parent station', () => {
    const csv = createCsv(
      'child,Child platform,47.37,8.54,0,missing-station',
    );

    expect(() => parseGtfsStopsCsv(csv)).toThrow(
      /stop "child" references missing parent station "missing-station"/i,
    );
  });

  it('rejects a parent that is not a station', () => {
    const csv = createCsv(
      'parent-stop,Parent stop,47.37,8.54,0,',
      'child,Child platform,47.38,8.55,0,parent-stop',
    );

    expect(() => parseGtfsStopsCsv(csv)).toThrow(
      /stop "child" references "parent-stop".*not a station/i,
    );
  });

  it('rejects a station with a parent', () => {
    const csv = createCsv(
      'station,Station,47.37,8.54,1,parent-station',
    );

    expect(() => parseGtfsStopsCsv(csv)).toThrow(
      /station "station" must not have parent station "parent-station"/i,
    );
  });

  it.each(['5', '-1', 'unknown'])(
    'rejects unknown location_type %j',
    (locationType) => {
      const csv = createCsv(
        `location,Location,47.37,8.54,${locationType},`,
      );

      expect(() => parseGtfsStopsCsv(csv)).toThrow(
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

    expect(parseGtfsStopsCsv(csv)).toEqual([]);
  });
});
