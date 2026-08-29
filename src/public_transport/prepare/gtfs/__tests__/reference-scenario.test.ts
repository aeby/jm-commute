import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../../config';
import { parseGtfsTimeToSeconds } from '../parse-gtfs-time';
import { validateFeedDateRange } from '../validate-feed-date-range';

const referenceScenario = PROJECT_CONFIG.publicTransport.referenceScenario;
const serviceDate = referenceScenario.serviceDate.replaceAll('-', '');

describe('PROJECT_CONFIG transit reference scenario', () => {
  it('uses a Monday as its configured service date', () => {
    const date = new Date(
      `${referenceScenario.serviceDate}T00:00:00Z`,
    );

    expect(date.getUTCDay()).toBe(1);
  });

  it('keeps the fixed service date', () => {
    expect(referenceScenario.serviceDate).toBe('2026-09-07');
  });

  it('uses an exact two-hour representative morning window', () => {
    const windowStart = parseGtfsTimeToSeconds(
      referenceScenario.morningWindow.start,
    );
    const windowEnd = parseGtfsTimeToSeconds(
      referenceScenario.morningWindow.end,
    );

    expect(referenceScenario.morningWindow.start).toBe('07:00:00');
    expect(referenceScenario.morningWindow.end).toBe('09:00:00');
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
