import type { Locality } from './api/types';

interface RankedLocality {
  readonly locality: Locality;
  readonly rank: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** Match the canonical locality normalization used by the server package. */
export const normalizeLocalitySearchText = (value: string): string =>
  value
    .trim()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ');

export const formatLocality = (locality: Locality): string =>
  `${locality.postalCode} ${locality.city}`;

function rankLocality(locality: Locality, normalizedQuery: string): number | undefined {
  const postalCode = normalizeLocalitySearchText(locality.postalCode);
  const city = normalizeLocalitySearchText(locality.city);
  const label = `${postalCode} ${city}`;

  if (label === normalizedQuery) {
    return 0;
  }
  if (postalCode === normalizedQuery) {
    return 1;
  }
  if (city === normalizedQuery) {
    return 2;
  }
  if (label.startsWith(normalizedQuery)) {
    return 3;
  }
  if (postalCode.startsWith(normalizedQuery)) {
    return 4;
  }
  if (city.startsWith(normalizedQuery)) {
    return 5;
  }
  if (label.includes(normalizedQuery)) {
    return 6;
  }
  return undefined;
}

export function searchLocalities(
  localities: readonly Locality[],
  query: string,
  limit = 20,
): readonly Locality[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('Locality search result limit must be a positive integer.');
  }
  const normalizedQuery = normalizeLocalitySearchText(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  return localities
    .flatMap((locality): RankedLocality[] => {
      const rank = rankLocality(locality, normalizedQuery);
      return rank === undefined ? [] : [{ locality, rank }];
    })
    .toSorted(
      (left, right) =>
        left.rank - right.rank ||
        compareStrings(left.locality.localityId, right.locality.localityId),
    )
    .slice(0, limit)
    .map(({ locality }) => locality);
}
