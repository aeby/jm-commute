import { describe, expect, it } from 'vitest';

import { parseGtfsTransfersCsv } from '../parse-gtfs-transfers';

const HEADER =
  'from_stop_id,to_stop_id,from_route_id,to_route_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time,service_id';
const parseRow = (row: string) =>
  parseGtfsTransfersCsv(`${HEADER}\n${row}\n`)[0];

describe('parseGtfsTransfersCsv', () => {
  it('parses generic type 0 while preserving string IDs', () => {
    expect(parseRow('001,stop-b,,,,,0,,')).toEqual({
      fromStopId: '001',
      toStopId: 'stop-b',
      fromRouteId: undefined,
      toRouteId: undefined,
      fromTripId: undefined,
      toTripId: undefined,
      transferType: 0,
      minimumTransferTimeSeconds: undefined,
      serviceId: undefined,
    });
  });

  it('parses and preserves a type-2 minimum transfer time', () => {
    expect(parseRow('a,b,,,,,2,300,')?.minimumTransferTimeSeconds).toBe(300);
  });

  it('parses forbidden type 3', () => {
    expect(parseRow('a,b,,,,,3,,')?.transferType).toBe(3);
  });

  it('parses generic and trip-specific type 1 rows distinctly', () => {
    const generic = parseRow('a,b,,,,,1,,');
    const constrained = parseRow('a,b,,,trip-a,trip-b,1,,');

    expect(generic?.fromTripId).toBeUndefined();
    expect(constrained?.fromTripId).toBe('trip-a');
    expect(constrained?.toTripId).toBe('trip-b');
  });

  it.each([4, 5])('parses in-seat transfer type %i', (transferType) => {
    expect(parseRow(`a,b,,,trip-a,trip-b,${transferType},,`)?.transferType).toBe(
      transferType,
    );
  });

  it('preserves service-specific rules for active-date filtering later', () => {
    expect(parseRow('a,b,,,,,0,,service-a')?.serviceId).toBe('service-a');
  });

  it('rejects invalid transfer types', () => {
    expect(() => parseRow('a,b,,,,,6,,')).toThrow(/transfer_type/i);
  });

  it.each(['-1', '1.5', 'seconds'])(
    'rejects malformed minimum time %s',
    (minimumTime) => {
      expect(() => parseRow(`a,b,,,,,2,${minimumTime},`)).toThrow(
        /min_transfer_time/i,
      );
    },
  );
});
