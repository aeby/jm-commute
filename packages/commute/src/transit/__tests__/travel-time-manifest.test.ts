import { describe, expect, it } from 'vitest';

import {
  parseTransitTravelTimeManifest,
  parseTransitTravelTimeManifestJson,
} from '../travel-time-manifest.js';
import { transitManifest } from './travel-time-fixture.js';

describe('parseTransitTravelTimeManifest', () => {
  it('accepts strict transit provenance around the shared descriptor', () => {
    const value = transitManifest();

    expect(parseTransitTravelTimeManifest(value)).toEqual(value);
    expect(parseTransitTravelTimeManifestJson(JSON.stringify(value))).toEqual(
      value,
    );
  });

  it.each([
    ['mode', { ...transitManifest(), mode: 'CAR' }],
    [
      'extra source field',
      {
        ...transitManifest(),
        source: { ...transitManifest().source, unexpected: true },
      },
    ],
    [
      'invalid fingerprint',
      {
        ...transitManifest(),
        source: {
          ...transitManifest().source,
          timetableFingerprint: 'not-a-digest',
        },
      },
    ],
    [
      'invalid policy',
      {
        ...transitManifest(),
        source: {
          ...transitManifest().source,
          routingPolicy: {
            ...transitManifest().source.routingPolicy,
            maxTransfers: -1,
          },
        },
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseTransitTravelTimeManifest(value)).toThrow(
      'Invalid transit travel-time manifest',
    );
  });

  it.each([
    ['2026-02-30', '07:00:00', '09:00:00'],
    ['2026-09-07', '25:00:00', '09:00:00'],
    ['2026-09-07', '09:00:00', '07:00:00'],
  ])(
    'rejects invalid service date/window %s %s–%s',
    (serviceDate, start, end) => {
      const value = transitManifest();
      expect(() =>
        parseTransitTravelTimeManifest({
          ...value,
          source: {
            ...value.source,
            serviceDate,
            morningWindow: { start, end },
          },
        }),
      ).toThrow('Invalid transit travel-time manifest');
    },
  );

  it('delegates the four-hour matrix contract to the canonical parser', () => {
    const value = transitManifest();

    expect(() =>
      parseTransitTravelTimeManifest({
        ...value,
        matrix: { ...value.matrix, maxTravelMinutes: 120 },
      }),
    ).toThrow('expected 240');
  });
});
