import { describe, expect, it } from 'vitest';

import {
  parseFixedDayRoutingManifestJson,
  validateFixedDayRoutingManifestScenario,
} from '../parse-fixed-day-routing-manifest-json';

const manifestValue = () => ({
  schemaVersion: 1,
  sourceFeedVersion: 'feed-1',
  serviceDate: '2026-09-07',
  routingWindowStart: '07:00:00',
  routingWindowEnd: '09:00:00',
  tripsSha256: 'a'.repeat(64),
  tripCount: 3,
  scheduledTripCount: 2,
  frequencyTripCount: 1,
  stopTimeCount: 8,
  frequencyWindowCount: 1,
  excludedBeforeRoutingWindowTripCount: 4,
});

describe('parseFixedDayRoutingManifestJson', () => {
  it('parses the complete schema without changing its values', () => {
    expect(
      parseFixedDayRoutingManifestJson(
        JSON.stringify(manifestValue()),
        'test manifest',
      ),
    ).toEqual(manifestValue());
  });

  it('allows an omitted source feed version', () => {
    const { sourceFeedVersion: _omitted, ...withoutVersion } = manifestValue();
    expect(
      parseFixedDayRoutingManifestJson(
        JSON.stringify(withoutVersion),
        'test manifest',
      ),
    ).toEqual(withoutVersion);
  });

  it('rejects malformed JSON, schemas, counts, and inconsistent totals', () => {
    expect(() =>
      parseFixedDayRoutingManifestJson('{', 'test manifest'),
    ).toThrow(/test manifest.*JSON/i);
    expect(() =>
      parseFixedDayRoutingManifestJson('{}', 'test manifest'),
    ).toThrow(/schema-version 1/i);
    expect(() =>
      parseFixedDayRoutingManifestJson(
        JSON.stringify({ ...manifestValue(), stopTimeCount: -1 }),
        'test manifest',
      ),
    ).toThrow(/stopTimeCount/i);
    expect(() =>
      parseFixedDayRoutingManifestJson(
        JSON.stringify({ ...manifestValue(), tripCount: 4 }),
        'test manifest',
      ),
    ).toThrow(/scheduledTripCount plus frequencyTripCount/i);
    expect(() =>
      parseFixedDayRoutingManifestJson(
        JSON.stringify({ ...manifestValue(), tripsSha256: 'not-a-hash' }),
        'test manifest',
      ),
    ).toThrow(/tripsSha256/i);
  });
});

describe('validateFixedDayRoutingManifestScenario', () => {
  const manifest = parseFixedDayRoutingManifestJson(
    JSON.stringify(manifestValue()),
    'test manifest',
  );
  const expected = {
    serviceDate: '2026-09-07',
    routingWindowStart: '07:00:00',
    routingWindowEnd: '09:00:00',
  };

  it('accepts matching scenario metadata', () => {
    expect(() =>
      validateFixedDayRoutingManifestScenario(manifest, expected),
    ).not.toThrow();
  });

  it('rejects service-date and routing-window mismatches', () => {
    expect(() =>
      validateFixedDayRoutingManifestScenario(manifest, {
        ...expected,
        serviceDate: '2026-09-08',
      }),
    ).toThrow(/service date/i);
    expect(() =>
      validateFixedDayRoutingManifestScenario(manifest, {
        ...expected,
        routingWindowEnd: '10:00:00',
      }),
    ).toThrow(/window/i);
  });
});
