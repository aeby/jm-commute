import type { Locality, LocalityId } from '@jobmate/commute';

import {
  findNearbyTransitPlaces,
  type TransitPlace,
} from './places';

export interface LocalitySourceStopEntry {
  readonly localityId: LocalityId;
  readonly sourceStopIds: readonly string[];
}

export interface LocalitySourceStopSelectionOptions {
  readonly maxAccessDistanceMeters: number;
  readonly fallbackCandidateCount: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function sortLocalities(
  localities: readonly Locality[],
): readonly Locality[] {
  const sorted = localities.toSorted((left, right) =>
    compareStrings(left.localityId, right.localityId),
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1]?.localityId === sorted[index]?.localityId) {
      throw new Error(
        `Duplicate public-transport locality ID "${sorted[index]?.localityId}".`,
      );
    }
  }
  return sorted;
}

function validateOptions(
  options: LocalitySourceStopSelectionOptions,
): LocalitySourceStopSelectionOptions {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(
      'Locality source-stop selection options must be an object.',
    );
  }

  const { maxAccessDistanceMeters, fallbackCandidateCount } = options;

  if (
    !Number.isFinite(maxAccessDistanceMeters) ||
    maxAccessDistanceMeters < 0
  ) {
    throw new RangeError(
      'maxAccessDistanceMeters must be a finite number greater than or equal to zero.',
    );
  }

  if (
    !Number.isInteger(fallbackCandidateCount) ||
    fallbackCandidateCount <= 0
  ) {
    throw new RangeError(
      'fallbackCandidateCount must be a positive integer.',
    );
  }

  return { maxAccessDistanceMeters, fallbackCandidateCount };
}

function selectPlaces(
  locality: Locality,
  places: readonly TransitPlace[],
  options: LocalitySourceStopSelectionOptions,
): readonly TransitPlace[] {
  const placesWithinAccessRadius = findNearbyTransitPlaces(locality, places, {
    maxResults: Math.max(places.length, 1),
    maxDistanceMeters: options.maxAccessDistanceMeters,
  });
  const selected =
    placesWithinAccessRadius.length > 0
      ? placesWithinAccessRadius
      : findNearbyTransitPlaces(locality, places, {
          maxResults: options.fallbackCandidateCount,
        });

  return selected.map(({ place }) => place);
}

/**
 * Selects the source GTFS stops that provide public-transport access for each
 * canonical locality. Every place inside the configured radius participates;
 * the nearest-place fallback is used only when that set is empty.
 */
export function buildLocalitySourceStopEntries(
  localities: readonly Locality[],
  places: readonly TransitPlace[],
  options: LocalitySourceStopSelectionOptions,
): readonly LocalitySourceStopEntry[] {
  const validatedOptions = validateOptions(options);

  return sortLocalities(localities).map((locality) => {
    const sourceStopIds = new Set<string>();

    for (const place of selectPlaces(locality, places, validatedOptions)) {
      for (const sourceStopId of place.stopIds) {
        sourceStopIds.add(sourceStopId);
      }
    }

    return {
      localityId: locality.localityId,
      sourceStopIds: [...sourceStopIds].toSorted(compareStrings),
    };
  });
}
