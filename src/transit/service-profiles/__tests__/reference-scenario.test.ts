import { describe, expect, it } from 'vitest';

import { REFERENCE_TRANSIT_SCENARIO } from '../../reference-scenario';
import { parseGtfsTimeToSeconds } from '../parse-gtfs-time';
import { validateFeedDateRange } from '../validate-feed-date-range';

const serviceDate = REFERENCE_TRANSIT_SCENARIO.serviceDate.replaceAll('-', '');

describe('REFERENCE_TRANSIT_SCENARIO', () => {
  it('uses a Monday as its configured service date', () => {
    const date = new Date(
      `${REFERENCE_TRANSIT_SCENARIO.serviceDate}T00:00:00Z`,
    );

    expect(date.getUTCDay()).toBe(1);
  });

  it('keeps the fixed service date and reference departure time', () => {
    expect(REFERENCE_TRANSIT_SCENARIO.serviceDate).toBe('2026-09-07');
    expect(REFERENCE_TRANSIT_SCENARIO.departureTime).toBe('08:00:00');
  });

  it('uses an exact two-hour service-profile interval', () => {
    const windowStart = parseGtfsTimeToSeconds(
      REFERENCE_TRANSIT_SCENARIO.hubWindowStart,
    );
    const windowEnd = parseGtfsTimeToSeconds(
      REFERENCE_TRANSIT_SCENARIO.hubWindowEnd,
    );

    expect(REFERENCE_TRANSIT_SCENARIO.hubWindowStart).toBe('07:00:00');
    expect(REFERENCE_TRANSIT_SCENARIO.hubWindowEnd).toBe('09:00:00');
    expect(windowEnd - windowStart).toBe(2 * 60 * 60);
  });

  it('falls within the fixed GTFS feed validity range', () => {
    expect(() =>
      validateFeedDateRange('20251214', '20261212', serviceDate),
    ).not.toThrow();
  });

  it('fails clearly when a configured date is outside the feed range', () => {
    expect(() =>
      validateFeedDateRange('20260908', '20261212', serviceDate),
    ).toThrow(/outside.*validity range/i);
  });
});
