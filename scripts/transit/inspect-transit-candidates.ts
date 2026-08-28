import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '@core/config';
import { LocalityResolver } from '@jm/commute';
import { parseLocalitiesCsv } from '@core/localities/node';
import {
  selectTransitPlaceCandidates,
  type SelectTransitPlaceCandidatesOptions,
} from '@core/transit/candidates';
import {
  loadTransitCandidateInputs,
  readUtf8Input,
} from './prepared-transit-inputs';
import { RAW_LOCALITIES_PATH } from './paths';

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }

  return value;
}

function parseFallbackCandidateCount(value: string | undefined):
  | number
  | undefined {
  if (value === undefined) {
    return undefined;
  }

  const count = Number(value);

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('--fallback-candidate-count must be a positive integer.');
  }

  return count;
}

function parseMaxAccessDistanceMeters(
  value: string | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.trim().length === 0) {
    throw new Error(
      '--max-access-distance-meters must be a finite number greater than or equal to zero.',
    );
  }

  const meters = Number(value);

  if (!Number.isFinite(meters) || meters < 0) {
    throw new Error(
      '--max-access-distance-meters must be a finite number greater than or equal to zero.',
    );
  }

  return meters;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'localities-file': { type: 'string' },
      'postal-code': { type: 'string' },
      city: { type: 'string' },
      'max-access-distance-meters': { type: 'string' },
      'fallback-candidate-count': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  const localitiesFile = resolve(
    values['localities-file'] ?? RAW_LOCALITIES_PATH,
  );
  const postalCode = requireOption(values['postal-code'], 'postal-code');
  const city = requireOption(values.city, 'city');
  const maxAccessDistanceMeters = parseMaxAccessDistanceMeters(
    values['max-access-distance-meters'],
  );
  const fallbackCandidateCount = parseFallbackCandidateCount(
    values['fallback-candidate-count'],
  );
  const localitiesCsv = await readUtf8Input(
    localitiesFile,
    'locality CSV',
  );
  const localities = parseLocalitiesCsv(localitiesCsv);
  const locality = new LocalityResolver(localities).resolve({
    postalCode,
    city,
  });

  if (locality === undefined) {
    throw new Error(`Unable to resolve locality: ${postalCode} ${city}.`);
  }

  const { places, profileDataset } = await loadTransitCandidateInputs();
  const options: SelectTransitPlaceCandidatesOptions = {
    ...(maxAccessDistanceMeters === undefined
      ? {}
      : { maxAccessDistanceMeters }),
    ...(fallbackCandidateCount === undefined
      ? {}
      : { fallbackCandidateCount }),
  };
  const selection = selectTransitPlaceCandidates(
    locality,
    places,
    profileDataset,
    options,
  );
  const configuredAccessDistanceMeters =
    maxAccessDistanceMeters ??
    PROJECT_CONFIG.transit.candidateSelection.maxAccessDistanceMeters;

  if (selection.candidates.length === 0) {
    throw new Error(
      `No transit-place candidates found for ${locality.postalCode} ${locality.city}.`,
    );
  }

  console.log(`Locality: ${locality.postalCode} ${locality.city}`);
  console.log(`Coordinates: ${locality.latitude}, ${locality.longitude}`);
  console.log(`Selection mode: ${selection.mode}`);
  console.log(
    `Maximum access distance: ${configuredAccessDistanceMeters} m`,
  );
  console.log(`Candidates: ${selection.candidates.length}`);

  if (selection.mode === 'NEAREST_FALLBACK') {
    console.log('');
    console.warn(
      `No transit place exists within ${configuredAccessDistanceMeters} m.`,
    );
    console.warn(
      `Showing the ${selection.candidates.length} geographically nearest fallback candidates.`,
    );
    console.warn('Alternative access may be required.');
  }

  selection.candidates.forEach(
    ({ place, profile, distanceMeters }, index) => {
      console.log('');
      console.log(`${index + 1}. ${place.name}`);
      console.log(`   Distance: ${distanceMeters.toFixed(1)} m`);
      console.log(`   Routes: ${profile.routeCount}`);
      console.log(`   Departures: ${profile.departureCount}`);
      console.log(`   Rail routes: ${profile.railRouteCount}`);
      console.log(`   Rail departures: ${profile.railDepartureCount}`);
      console.log(`   ID: ${place.id}`);
    },
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
