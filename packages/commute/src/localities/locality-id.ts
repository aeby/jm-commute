import { normalizeCityName } from './normalize-city-name.js';
import { normalizeSwissPostalCode } from './postal-code.js';
import type { LocalityId } from './types.js';

export function createLocalityId(
  postalCode: string,
  city: string,
): LocalityId {
  if (typeof postalCode !== 'string') {
    throw new TypeError('Locality postal code must be a string.');
  }
  if (typeof city !== 'string') {
    throw new TypeError('Locality city must be a string.');
  }

  const normalizedPostalCode = normalizeSwissPostalCode(postalCode);
  if (normalizedPostalCode === undefined) {
    throw new Error('Locality postal code must contain exactly four digits.');
  }

  const normalizedCity = normalizeCityName(city);
  if (normalizedCity.length === 0) {
    throw new Error('Locality city must not be empty.');
  }

  return `${normalizedPostalCode}:${normalizedCity}`;
}
