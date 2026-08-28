import {
  createLocalityId,
  normalizeCityName,
  type Locality,
} from '../../localities';
import { createTransitPlaceCandidateSelector } from '../candidates';
import type { TransitPlace } from '../places';
import type { TransitPlaceServiceProfileDataset } from '../service-profiles';
import type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
} from './types';

const MAXIMUM_UINT32 = 0xffff_ffff;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function compareCanonicalLocalities(left: Locality, right: Locality): number {
  const postalCodeComparison = compareStrings(
    left.postalCode.trim(),
    right.postalCode.trim(),
  );
  if (postalCodeComparison !== 0) {
    return postalCodeComparison;
  }

  const normalizedCityComparison = compareStrings(
    normalizeCityName(left.city),
    normalizeCityName(right.city),
  );
  if (normalizedCityComparison !== 0) {
    return normalizedCityComparison;
  }

  const cityComparison = compareStrings(left.city.trim(), right.city.trim());
  if (cityComparison !== 0) {
    return cityComparison;
  }

  const latitudeComparison = left.latitude - right.latitude;
  return latitudeComparison !== 0
    ? latitudeComparison
    : left.longitude - right.longitude;
}

function uniqueCanonicalLocalities(
  localities: readonly Locality[],
): readonly Locality[] {
  const localitiesById = new Map<string, Locality>();

  for (const locality of localities.toSorted(compareCanonicalLocalities)) {
    const postalCode = locality.postalCode.trim();
    const city = locality.city.trim();
    const localityId = createLocalityId(postalCode, city);

    if (!localitiesById.has(localityId)) {
      localitiesById.set(localityId, { ...locality, postalCode, city });
    }
  }

  return [...localitiesById.values()];
}

function compareEntries(
  left: LocalityRoutingEntry,
  right: LocalityRoutingEntry,
): number {
  const postalCodeComparison = compareStrings(
    left.postalCode,
    right.postalCode,
  );
  if (postalCodeComparison !== 0) {
    return postalCodeComparison;
  }

  const cityComparison = compareStrings(
    normalizeCityName(left.city),
    normalizeCityName(right.city),
  );
  return cityComparison !== 0
    ? cityComparison
    : compareStrings(left.localityId, right.localityId);
}

function validateStopIndex(stopIndex: number, sourceStopId: string): void {
  if (
    !Number.isInteger(stopIndex) ||
    stopIndex < 0 ||
    stopIndex > MAXIMUM_UINT32
  ) {
    throw new RangeError(
      `Dense stop index for source stop "${sourceStopId}" must be a Uint32 integer.`,
    );
  }
}

export function buildLocalityRoutingIndex(
  localities: readonly Locality[],
  places: readonly TransitPlace[],
  profileDataset: TransitPlaceServiceProfileDataset,
  denseStopLookup: ReadonlyMap<string, number>,
): LocalityRoutingIndex {
  const selectCandidates = createTransitPlaceCandidateSelector(
    places,
    profileDataset,
  );

  const entries = uniqueCanonicalLocalities(localities).map(
    (locality): LocalityRoutingEntry => {
      const selection = selectCandidates(locality);
      const stopIndexes = new Set<number>();

      for (const { place } of selection.candidates) {
        for (const sourceStopId of place.stopIds) {
          const stopIndex = denseStopLookup.get(sourceStopId);
          if (stopIndex !== undefined) {
            validateStopIndex(stopIndex, sourceStopId);
            stopIndexes.add(stopIndex);
          }
        }
      }

      return {
        localityId: createLocalityId(locality.postalCode, locality.city),
        postalCode: locality.postalCode,
        city: locality.city,
        selectionMode: selection.mode,
        stopIndexes: Uint32Array.from(
          [...stopIndexes].toSorted((left, right) => left - right),
        ),
      };
    },
  );

  return { entries: entries.toSorted(compareEntries) };
}
