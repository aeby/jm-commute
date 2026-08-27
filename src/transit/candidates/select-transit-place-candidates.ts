import type { Locality } from '../../localities';
import { PROJECT_CONFIG } from '../../config';
import {
  findNearbyTransitPlaces,
  type NearbyTransitPlace,
  type TransitPlace,
} from '../places';
import type {
  TransitPlaceServiceProfile,
  TransitPlaceServiceProfileDataset,
} from '../service-profiles';
import { compareTransitPlaceCandidates } from './compare-transit-place-candidates';
import type {
  SelectTransitPlaceCandidatesOptions,
  TransitCandidateSelectionMode,
  TransitPlaceCandidate,
  TransitPlaceCandidateSelection,
} from './types';

interface ValidatedSelectionOptions {
  readonly maxAccessDistanceMeters: number;
  readonly fallbackCandidateCount: number;
}

const COUNT_FIELDS = [
  'departureCount',
  'routeCount',
  'railDepartureCount',
  'railRouteCount',
] as const;

function validateOptions(
  options: SelectTransitPlaceCandidatesOptions | undefined,
): ValidatedSelectionOptions {
  if (
    options !== undefined &&
    (options === null || typeof options !== 'object')
  ) {
    throw new TypeError('Candidate-selection options must be an object.');
  }

  const maxAccessDistanceMeters =
    options?.maxAccessDistanceMeters ??
    PROJECT_CONFIG.transit.candidateSelection.maxAccessDistanceMeters;
  const fallbackCandidateCount =
    options?.fallbackCandidateCount ??
    PROJECT_CONFIG.transit.candidateSelection.fallbackCandidateCount;

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

function validateDatasetMetadata(
  dataset: TransitPlaceServiceProfileDataset,
): void {
  const { referenceScenario } = PROJECT_CONFIG.transit;
  const expectedMetadata = {
    serviceDate: referenceScenario.serviceDate,
    departureTime: referenceScenario.departureTime,
    windowStart: referenceScenario.serviceProfileWindow.start,
    windowEnd: referenceScenario.serviceProfileWindow.end,
  } as const;

  for (const [field, expectedValue] of Object.entries(expectedMetadata)) {
    const actualValue = dataset[field as keyof typeof expectedMetadata];

    if (actualValue !== expectedValue) {
      throw new Error(
        `Service-profile dataset ${field} mismatch: expected "${expectedValue}", received "${String(actualValue)}".`,
      );
    }
  }
}

function buildProfileByPlaceId(
  places: readonly TransitPlace[],
  dataset: TransitPlaceServiceProfileDataset,
): ReadonlyMap<string, TransitPlaceServiceProfile> {
  if (dataset === null || typeof dataset !== 'object') {
    throw new TypeError('Service-profile dataset must be an object.');
  }

  validateDatasetMetadata(dataset);

  if (!Array.isArray(dataset.profiles)) {
    throw new TypeError('Service-profile dataset profiles must be an array.');
  }

  const placeIds = new Set<string>();

  for (const place of places) {
    if (typeof place.id !== 'string' || place.id.trim().length === 0) {
      throw new Error('Every transit place must have a nonempty string ID.');
    }

    if (placeIds.has(place.id)) {
      throw new Error(`Duplicate transit-place ID "${place.id}".`);
    }

    placeIds.add(place.id);
  }

  const profileByPlaceId = new Map<string, TransitPlaceServiceProfile>();

  for (const profile of dataset.profiles) {
    if (profile === null || typeof profile !== 'object') {
      throw new TypeError('Every service profile must be an object.');
    }

    if (
      typeof profile.placeId !== 'string' ||
      profile.placeId.trim().length === 0
    ) {
      throw new Error('Every service profile must have a nonempty placeId.');
    }

    if (profileByPlaceId.has(profile.placeId)) {
      throw new Error(
        `Duplicate service profile for placeId "${profile.placeId}".`,
      );
    }

    for (const field of COUNT_FIELDS) {
      const count = profile[field];

      if (!Number.isInteger(count) || count < 0) {
        throw new Error(
          `Service profile "${profile.placeId}" field ${field} must be a nonnegative integer.`,
        );
      }
    }

    if (!placeIds.has(profile.placeId)) {
      throw new Error(
        `Service profile refers to unknown transit-place ID "${profile.placeId}".`,
      );
    }

    profileByPlaceId.set(profile.placeId, profile);
  }

  for (const placeId of placeIds) {
    if (!profileByPlaceId.has(placeId)) {
      throw new Error(`Missing service profile for transit place "${placeId}".`);
    }
  }

  return profileByPlaceId;
}

function rankCandidates(
  nearbyPlaces: readonly NearbyTransitPlace[],
  profileByPlaceId: ReadonlyMap<string, TransitPlaceServiceProfile>,
): readonly TransitPlaceCandidate[] {
  const candidates = nearbyPlaces.map(({ place, distanceMeters }) => {
    const profile = profileByPlaceId.get(place.id);

    if (profile === undefined) {
      throw new Error(`Missing service profile for transit place "${place.id}".`);
    }

    return Object.freeze({ place, profile, distanceMeters });
  });

  return Object.freeze(candidates.toSorted(compareTransitPlaceCandidates));
}

export function selectTransitPlaceCandidates(
  locality: Locality,
  places: readonly TransitPlace[],
  profileDataset: TransitPlaceServiceProfileDataset,
  options?: SelectTransitPlaceCandidatesOptions,
): TransitPlaceCandidateSelection {
  const { maxAccessDistanceMeters, fallbackCandidateCount } =
    validateOptions(options);
  const profileByPlaceId = buildProfileByPlaceId(places, profileDataset);
  const maximumNormalResults = Math.max(places.length, 1);
  const placesWithinAccessRadius = findNearbyTransitPlaces(locality, places, {
    maxResults: maximumNormalResults,
    maxDistanceMeters: maxAccessDistanceMeters,
  });
  let mode: TransitCandidateSelectionMode;
  let memberPlaces: readonly NearbyTransitPlace[];

  if (placesWithinAccessRadius.length > 0) {
    mode = 'WITHIN_ACCESS_RADIUS';
    memberPlaces = placesWithinAccessRadius;
  } else {
    mode = 'NEAREST_FALLBACK';
    memberPlaces = findNearbyTransitPlaces(locality, places, {
      maxResults: fallbackCandidateCount,
    });
  }

  return Object.freeze({
    mode,
    candidates: rankCandidates(memberPlaces, profileByPlaceId),
  });
}
