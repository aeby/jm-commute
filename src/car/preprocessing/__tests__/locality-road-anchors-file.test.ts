import { describe, expect, it } from 'vitest';

import type { CarLocalityInput } from '../types';
import {
  createCarLocalityRoadAnchorsFile,
  parseCarLocalityRoadAnchorsFile,
  parseCarLocalityRoadAnchorsJson,
  validateCarLocalityRoadAnchorsAgainstInputs,
} from '@core/car/preprocessing';

const SHA256 = 'a'.repeat(64);

function validAnchor(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    localityId: '8001:zurich',
    latitude: 47.372321,
    longitude: 8.542786,
    snapDistanceMeters: 24.1,
    ...overrides,
  };
}

function validFile(
  anchors: readonly unknown[] = [validAnchor()],
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    localityCount: anchors.length,
    localityInputSha256: SHA256,
    roadGraph: {
      sourcePbfSha256: SHA256,
      osrmVersion: '26.8.0',
      profile: 'car.lua',
      algorithm: 'ch',
    },
    anchors,
  };
}

describe('parseCarLocalityRoadAnchorsFile', () => {
  it('accepts a valid strict file', () => {
    expect(parseCarLocalityRoadAnchorsFile(validFile())).toEqual(validFile());
  });

  it('allows different localities to share one anchor coordinate', () => {
    const shared = { latitude: 47, longitude: 8, snapDistanceMeters: 10 };
    expect(
      parseCarLocalityRoadAnchorsFile(
        validFile([
          validAnchor({ localityId: '3011:bern', ...shared }),
          validAnchor({ localityId: '8001:zurich', ...shared }),
        ]),
      ).anchors,
    ).toHaveLength(2);
  });

  it('rejects duplicate locality IDs', () => {
    expect(() =>
      parseCarLocalityRoadAnchorsFile(
        validFile([validAnchor(), validAnchor()]),
      ),
    ).toThrow('duplicate ID "8001:zurich"');
  });

  it.each([-90.01, 90.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid latitude %s',
    (latitude) => {
      expect(() =>
        parseCarLocalityRoadAnchorsFile(
          validFile([validAnchor({ latitude })]),
        ),
      ).toThrow('finite latitude');
    },
  );

  it.each([-180.01, 180.01, Number.NEGATIVE_INFINITY])(
    'rejects invalid longitude %s',
    (longitude) => {
      expect(() =>
        parseCarLocalityRoadAnchorsFile(
          validFile([validAnchor({ longitude })]),
        ),
      ).toThrow('finite longitude');
    },
  );

  it('rejects a negative or nonfinite snap distance', () => {
    expect(() =>
      parseCarLocalityRoadAnchorsFile(
        validFile([validAnchor({ snapDistanceMeters: -1 })]),
      ),
    ).toThrow('nonnegative finite number');
    expect(() =>
      parseCarLocalityRoadAnchorsFile(
        validFile([validAnchor({ snapDistanceMeters: Number.NaN })]),
      ),
    ).toThrow('nonnegative finite number');
  });

  it('rejects a nonfinite number parsed from otherwise valid JSON', () => {
    const json = JSON.stringify(validFile()).replace(
      '"latitude":47.372321',
      '"latitude":1e400',
    );
    expect(() => parseCarLocalityRoadAnchorsJson(json)).toThrow(
      'finite latitude',
    );
  });

  it('rejects the wrong schema version', () => {
    expect(() =>
      parseCarLocalityRoadAnchorsFile({
        ...validFile(),
        schemaVersion: 2,
      }),
    ).toThrow('schemaVersion: expected 1');
  });

  it('rejects malformed graph provenance and fingerprints', () => {
    expect(() =>
      parseCarLocalityRoadAnchorsFile({
        ...validFile(),
        localityInputSha256: 'ABC',
      }),
    ).toThrow('lowercase SHA-256 digest');
    expect(() =>
      parseCarLocalityRoadAnchorsFile({
        ...validFile(),
        roadGraph: {
          ...validFile().roadGraph as Readonly<Record<string, unknown>>,
          sourcePbfSha256: 'not-a-hash',
        },
      }),
    ).toThrow('lowercase SHA-256 digest');
    for (const [field, value] of [
      ['osrmVersion', 'latest'],
      ['profile', 'custom.lua'],
      ['algorithm', 'mld'],
    ] as const) {
      expect(() =>
        parseCarLocalityRoadAnchorsFile({
          ...validFile(),
          roadGraph: {
            ...validFile().roadGraph as Readonly<Record<string, unknown>>,
            [field]: value,
          },
        }),
      ).toThrow(`roadGraph.${field}`);
    }
  });

  it('requires every field to be an own enumerable property', () => {
    const inheritedAnchor = Object.create(validAnchor()) as Record<
      string,
      unknown
    >;
    expect(() =>
      parseCarLocalityRoadAnchorsFile(validFile([inheritedAnchor])),
    ).toThrow('missing field(s)');

    const rootWithoutAnchors = { ...validFile() };
    delete (rootWithoutAnchors as { anchors?: unknown }).anchors;
    expect(() =>
      parseCarLocalityRoadAnchorsFile(rootWithoutAnchors),
    ).toThrow('missing field(s) anchors');
  });

  it('rejects out-of-order, partial, and extra anchor data', () => {
    expect(() =>
      parseCarLocalityRoadAnchorsFile(
        validFile([
          validAnchor({ localityId: '8001:zurich' }),
          validAnchor({ localityId: '3011:bern' }),
        ]),
      ),
    ).toThrow('ascending locality-ID order');
    expect(() =>
      parseCarLocalityRoadAnchorsFile({
        ...validFile(),
        localityCount: 2,
      }),
    ).toThrow('anchors has 1 entries');
    expect(() =>
      parseCarLocalityRoadAnchorsFile(
        validFile([validAnchor({ name: 'must not persist' })]),
      ),
    ).toThrow('unexpected field(s) name');
  });
});

describe('car locality road anchors completeness', () => {
  const localityInputs: readonly CarLocalityInput[] = [
    {
      localityId: '3011:bern',
      postalCode: '3011',
      city: 'Bern',
      latitude: 46.95,
      longitude: 7.44,
    },
    {
      localityId: '8001:zurich',
      postalCode: '8001',
      city: 'Zürich',
      latitude: 47.37,
      longitude: 8.54,
    },
  ];

  it('creates and validates a complete deterministic file', () => {
    const file = createCarLocalityRoadAnchorsFile({
      localityInputs,
      anchors: [
        {
          localityId: '8001:zurich',
          latitude: 47.371,
          longitude: 8.541,
          snapDistanceMeters: 10,
        },
        {
          localityId: '3011:bern',
          latitude: 46.951,
          longitude: 7.441,
          snapDistanceMeters: 20,
        },
      ],
      roadGraph: {
        sourcePbfSha256: SHA256,
        osrmVersion: '26.8.0',
        profile: 'car.lua',
        algorithm: 'ch',
      },
    });

    expect(file.anchors.map(({ localityId }) => localityId)).toEqual([
      '3011:bern',
      '8001:zurich',
    ]);
    expect(() =>
      validateCarLocalityRoadAnchorsAgainstInputs(file, localityInputs),
    ).not.toThrow();
  });

  it('rejects a file that is stale or partial relative to current inputs', () => {
    const parsed = parseCarLocalityRoadAnchorsFile(validFile());
    expect(() =>
      validateCarLocalityRoadAnchorsAgainstInputs(parsed, localityInputs),
    ).toThrow(/contain 1 entries|fingerprint/u);
  });
});
