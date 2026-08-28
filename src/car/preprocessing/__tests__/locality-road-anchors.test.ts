import { describe, expect, it } from 'vitest';

import type { CarLocalityInput, SnappedRoadPoint } from '../types';
import {
  CarLocalityRoadAnchorGenerationError,
  createLocalityInputFingerprint,
  generateCarLocalityRoadAnchors,
} from '@core/car/preprocessing';

function input(
  localityId: string,
  latitude: number,
  longitude: number,
): CarLocalityInput {
  const separator = localityId.indexOf(':');
  return {
    localityId,
    postalCode: localityId.slice(0, separator),
    city: localityId.slice(separator + 1),
    latitude,
    longitude,
  };
}

function snapped(
  latitude: number,
  longitude: number,
  distanceMeters: number,
): SnappedRoadPoint {
  return { latitude, longitude, distanceMeters, name: 'diagnostic only' };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}

const INPUTS = [
  input('8001:zurich', 47.37, 8.54),
  input('3011:bern', 46.95, 7.44),
  input('8750:glarus', 47.04, 9.06),
] as const;

describe('locality road anchor generation', () => {
  it('sorts deterministically and preserves existing locality IDs', async () => {
    const anchors = await generateCarLocalityRoadAnchors(
      INPUTS,
      async ({ latitude, longitude }) =>
        snapped(latitude + 0.001, longitude + 0.002, latitude),
      { concurrency: 2 },
    );

    expect(anchors.map(({ localityId }) => localityId)).toEqual([
      '3011:bern',
      '8001:zurich',
      '8750:glarus',
    ]);
    expect(anchors[1]).toMatchObject({
      localityId: '8001:zurich',
      longitude: 8.542,
      snapDistanceMeters: 47.37,
    });
    expect(anchors[1]?.latitude).toBeCloseTo(47.371, 12);
    expect(INPUTS[0]?.localityId).toBe('8001:zurich');
  });

  it('is independent of asynchronous nearest-response order', async () => {
    const pending = new Map(
      INPUTS.map(({ latitude }) => [latitude, deferred<SnappedRoadPoint>()]),
    );
    const generation = generateCarLocalityRoadAnchors(
      INPUTS,
      ({ latitude }) => pending.get(latitude)?.promise as Promise<SnappedRoadPoint>,
      { concurrency: 3 },
    );

    pending.get(47.04)?.resolve(snapped(47.041, 9.061, 30));
    pending.get(47.37)?.resolve(snapped(47.371, 8.541, 10));
    pending.get(46.95)?.resolve(snapped(46.951, 7.441, 20));

    await expect(generation).resolves.toEqual([
      {
        localityId: '3011:bern',
        latitude: 46.951,
        longitude: 7.441,
        snapDistanceMeters: 20,
      },
      {
        localityId: '8001:zurich',
        latitude: 47.371,
        longitude: 8.541,
        snapDistanceMeters: 10,
      },
      {
        localityId: '8750:glarus',
        latitude: 47.041,
        longitude: 9.061,
        snapDistanceMeters: 30,
      },
    ]);
  });

  it('aggregates every failed locality in canonical order', async () => {
    const attempted: string[] = [];
    let thrown: unknown;

    try {
      await generateCarLocalityRoadAnchors(
        INPUTS,
        async ({ latitude }) => {
          attempted.push(String(latitude));
          if (latitude !== 47.37) {
            throw new Error(`no road at ${latitude}`);
          }
          return snapped(47.371, 8.541, 10);
        },
        { concurrency: 2 },
      );
    } catch (error) {
      thrown = error;
    }

    expect(attempted).toHaveLength(3);
    expect(thrown).toBeInstanceOf(CarLocalityRoadAnchorGenerationError);
    expect(
      (thrown as CarLocalityRoadAnchorGenerationError).failures.map(
        ({ localityId }) => localityId,
      ),
    ).toEqual(['3011:bern', '8750:glarus']);
  });

  it('treats malformed fulfilled nearest results as locality failures', async () => {
    let thrown: unknown;
    try {
      await generateCarLocalityRoadAnchors(
        [INPUTS[0]],
        async () =>
          snapped(Number.NaN, 8.541, 10),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CarLocalityRoadAnchorGenerationError);
    expect(
      (thrown as CarLocalityRoadAnchorGenerationError).failures[0],
    ).toMatchObject({
      localityId: '8001:zurich',
      message: expect.stringContaining('invalid latitude'),
    });
  });

  it('never exceeds the configured request concurrency', async () => {
    const gate = deferred<void>();
    const boundedInputs = [
      input('1000:one', 46.1, 7.1),
      input('1001:two', 46.2, 7.2),
      input('1002:three', 46.3, 7.3),
      input('1003:four', 46.4, 7.4),
      input('1004:five', 46.5, 7.5),
    ];
    let active = 0;
    let peakActive = 0;
    let started = 0;
    const generation = generateCarLocalityRoadAnchors(
      boundedInputs,
      async ({ latitude, longitude }) => {
        started += 1;
        active += 1;
        peakActive = Math.max(peakActive, active);
        await gate.promise;
        active -= 1;
        return snapped(latitude, longitude, 0);
      },
      { concurrency: 2 },
    );

    expect(started).toBe(2);
    gate.resolve(undefined);
    await expect(generation).resolves.toHaveLength(5);
    expect(peakActive).toBe(2);
  });

  it('reports monotonic progress without affecting generated order', async () => {
    const completed: number[] = [];
    await generateCarLocalityRoadAnchors(
      INPUTS,
      async ({ latitude, longitude }) => snapped(latitude, longitude, 0),
      {
        concurrency: 2,
        onProgress: (progress) => completed.push(progress.completed),
      },
    );
    expect(completed).toEqual([1, 2, 3]);
  });

  it('reports failure progress and does not let callback errors hide snap failures', async () => {
    const snapshots: Array<{
      readonly completed: number;
      readonly succeeded: number;
      readonly failed: number;
      readonly total: number;
    }> = [];
    let thrown: unknown;
    try {
      await generateCarLocalityRoadAnchors(
        INPUTS.slice(0, 2),
        async ({ latitude, longitude }) => {
          if (latitude === 46.95) {
            throw new Error('no road');
          }
          return snapped(latitude, longitude, 0);
        },
        {
          concurrency: 1,
          onProgress: (progress) => {
            snapshots.push(progress);
            if (progress.completed === 1) {
              throw new Error('progress display failed');
            }
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(snapshots).toEqual([
      { completed: 1, succeeded: 0, failed: 1, total: 2 },
      { completed: 2, succeeded: 1, failed: 1, total: 2 },
    ]);
    expect(thrown).toBeInstanceOf(CarLocalityRoadAnchorGenerationError);
    expect(
      (thrown as CarLocalityRoadAnchorGenerationError).failures.map(
        ({ localityId }) => localityId,
      ),
    ).toEqual(['3011:bern']);
  });
});

describe('locality input fingerprint', () => {
  it('is deterministic regardless of input order', () => {
    expect(createLocalityInputFingerprint(INPUTS.toReversed())).toBe(
      createLocalityInputFingerprint(INPUTS),
    );
    expect(createLocalityInputFingerprint(INPUTS)).toBe(
      'fc4b1bd4b174abfd30279d60e7e5b1bd34be611c189418abd5cb289bf6b0b0aa',
    );
    expect(
      createLocalityInputFingerprint(
        INPUTS.map((entry) => ({
          ...entry,
          postalCode: 'not fingerprinted',
          city: 'not fingerprinted',
        })),
      ),
    ).toBe(createLocalityInputFingerprint(INPUTS));
  });

  it('changes when one coordinate changes', () => {
    const changed = [
      { ...INPUTS[0], longitude: INPUTS[0].longitude + 0.000_001 },
      ...INPUTS.slice(1),
    ];
    expect(createLocalityInputFingerprint(changed)).not.toBe(
      createLocalityInputFingerprint(INPUTS),
    );
  });

  it('rejects duplicate IDs and nonfinite coordinates before hashing', () => {
    expect(() =>
      createLocalityInputFingerprint([INPUTS[0], { ...INPUTS[0] }]),
    ).toThrow('Duplicate car locality input');
    expect(() =>
      createLocalityInputFingerprint([
        { ...INPUTS[0], latitude: Number.NaN },
      ]),
    ).toThrow('invalid latitude');
  });
});
