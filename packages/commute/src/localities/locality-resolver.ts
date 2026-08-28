import { normalizeCityName } from './normalize-city-name.js';
import { normalizeSwissPostalCode } from './postal-code.js';
import type { Locality, LocalityQuery } from './types.js';

function createLocalityKey(postalCode: string, city: string): string {
  return `${postalCode.trim()}\u0000${normalizeCityName(city)}`;
}

export class LocalityResolver {
  private readonly localitiesByKey: Map<string, Locality>;

  constructor(localities: readonly Locality[]) {
    this.localitiesByKey = new Map(
      localities.map((locality) => [
        createLocalityKey(locality.postalCode, locality.city),
        locality,
      ]),
    );
  }

  resolve(query: LocalityQuery): Locality | undefined {
    if (
      query === null ||
      typeof query !== 'object' ||
      typeof query.postalCode !== 'string' ||
      typeof query.city !== 'string'
    ) {
      return undefined;
    }

    const postalCode = normalizeSwissPostalCode(query.postalCode);
    const city = normalizeCityName(query.city);

    if (postalCode === undefined || city.length === 0) {
      return undefined;
    }

    return this.localitiesByKey.get(`${postalCode}\u0000${city}`);
  }
}
