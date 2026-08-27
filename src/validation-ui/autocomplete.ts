import { normalizeCityName } from '../localities';
import type { ValidationLocality } from './validation-data';

interface RankedLocality {
  readonly locality: ValidationLocality;
  readonly rank: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function matchRank(
  locality: ValidationLocality,
  rawQuery: string,
  normalizedQuery: string,
): number | undefined {
  const normalizedCity = normalizeCityName(locality.city);
  const normalizedLabel = `${locality.postalCode} ${normalizedCity}`;

  if (normalizedQuery === normalizedLabel) {
    return 0;
  }
  if (rawQuery === locality.postalCode) {
    return 1;
  }
  if (/^[0-9]+$/.test(rawQuery) && locality.postalCode.startsWith(rawQuery)) {
    return 2;
  }
  if (normalizedCity === normalizedQuery) {
    return 3;
  }
  if (normalizedCity.startsWith(normalizedQuery)) {
    return 4;
  }
  if (normalizedCity.includes(normalizedQuery)) {
    return 5;
  }
  return undefined;
}

export function searchValidationLocalities(
  localities: readonly ValidationLocality[],
  query: string,
  resultLimit: number,
): readonly ValidationLocality[] {
  if (!Number.isInteger(resultLimit) || resultLimit <= 0) {
    throw new RangeError('Autocomplete resultLimit must be a positive integer.');
  }

  const rawQuery = query.trim().toLowerCase();
  const normalizedQuery = normalizeCityName(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: RankedLocality[] = [];
  for (const locality of localities) {
    const rank = matchRank(locality, rawQuery, normalizedQuery);
    if (rank !== undefined) {
      matches.push({ locality, rank });
    }
  }

  return matches
    .toSorted(
      (left, right) =>
        left.rank - right.rank ||
        compareStrings(left.locality.localityId, right.locality.localityId),
    )
    .slice(0, resultLimit)
    .map(({ locality }) => locality);
}
