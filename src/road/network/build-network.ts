import { createHash } from 'node:crypto';

import type { Locality, LocalityId } from '@jm/commute';

import type { PreparedData, RoadGraphMetadata } from '../prepare';
import type {
  RoadLocalityAnchor,
  RoadNetwork,
  RoadRouter,
  SnappedRoadPoint,
} from './types';

export interface RoadNetworkProgress {
  readonly completedLocalities: number;
  readonly totalLocalities: number;
}

export interface BuildNetworkOptions {
  readonly preparedData: PreparedData;
  readonly router: RoadRouter;
  readonly concurrency?: number;
  readonly onProgress?: (progress: RoadNetworkProgress) => void | Promise<void>;
}

interface AnchorFailure {
  readonly localityId: LocalityId;
  readonly error: unknown;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function localityInputFingerprint(localities: readonly Locality[]): string {
  return sha256(
    JSON.stringify(
      localities.map(({ localityId, latitude, longitude }) => ({
        localityId,
        latitude,
        longitude,
      })),
    ),
  );
}

function validateSnappedPoint(
  point: SnappedRoadPoint,
  localityId: LocalityId,
): void {
  if (
    typeof point !== 'object' ||
    point === null ||
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90 ||
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180 ||
    !Number.isFinite(point.distanceMeters) ||
    point.distanceMeters < 0
  ) {
    throw new Error(`Nearest-road result for "${localityId}" is invalid.`);
  }
}

function anchorsFingerprint(
  anchors: readonly RoadLocalityAnchor[],
  localityInputSha256: string,
  roadGraph: RoadGraphMetadata,
): string {
  return sha256(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        localityCount: anchors.length,
        localityInputSha256,
        roadGraph,
        anchors,
      },
      null,
      2,
    )}\n`,
  );
}

/** Maps every canonical locality to its routable point on the prepared graph. */
export async function buildNetwork(
  options: BuildNetworkOptions,
): Promise<RoadNetwork> {
  const localities = options.preparedData.localities;
  if (localities.length === 0) {
    throw new Error('Road network requires at least one locality.');
  }
  const concurrency = options.concurrency ?? 16;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError('Road-network concurrency must be a positive integer.');
  }
  for (let index = 1; index < localities.length; index += 1) {
    if (
      (localities[index - 1] as Locality).localityId >=
      (localities[index] as Locality).localityId
    ) {
      throw new Error('Road localities must use unique lexical ID order.');
    }
  }

  const anchors: RoadLocalityAnchor[] = [];
  const failures: AnchorFailure[] = [];
  let nextIndex = 0;
  let completedLocalities = 0;

  async function worker(): Promise<void> {
    while (nextIndex < localities.length) {
      const index = nextIndex;
      nextIndex += 1;
      const locality = localities[index] as Locality;
      try {
        const point = await options.router.findNearestRoadPoint(locality);
        validateSnappedPoint(point, locality.localityId);
        anchors[index] = {
          localityId: locality.localityId,
          latitude: point.latitude,
          longitude: point.longitude,
          snapDistanceMeters: point.distanceMeters,
        };
      } catch (error) {
        failures.push({ localityId: locality.localityId, error });
      }
      completedLocalities += 1;
      await options.onProgress?.({
        completedLocalities,
        totalLocalities: localities.length,
      });
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, localities.length) },
      async () => worker(),
    ),
  );
  if (failures.length > 0) {
    failures.sort((left, right) =>
      left.localityId < right.localityId ? -1 : 1,
    );
    throw new Error(
      `Unable to anchor ${failures.length} of ${localities.length} road localities:\n` +
        failures
          .map(({ localityId, error }) =>
            `${localityId}: ${error instanceof Error ? error.message : String(error)}`,
          )
          .join('\n'),
      { cause: failures[0]?.error },
    );
  }

  const localityInputSha256 = localityInputFingerprint(localities);
  return Object.freeze({
    router: options.router,
    localities: Object.freeze(anchors),
    localityInputSha256,
    anchorsSha256: anchorsFingerprint(
      anchors,
      localityInputSha256,
      options.preparedData.roadGraph,
    ),
    roadGraph: options.preparedData.roadGraph,
  });
}
