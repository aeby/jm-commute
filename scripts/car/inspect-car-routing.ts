import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  buildCarLocalityInputs,
  OsrmClient,
  type CarLocalityInput,
  type CarRouteEstimate,
  type Coordinate,
  type SnappedRoadPoint,
} from '@core/car/preprocessing';
import {
  LocalityResolver,
  type Locality,
  type LocalityQuery,
} from '@core/localities';
import { parseLocalitiesCsv } from '../../src/localities/node';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const DEFAULT_LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);
const SNAP_CONCURRENCY = 16;
const LARGE_SNAP_METERS = 1_000;
const SUSPICIOUS_DETOUR_FACTOR = 2.5;

interface DiagnosticRoute {
  readonly category: 'required' | 'border' | 'mountain/rural';
  readonly from: LocalityQuery;
  readonly to: LocalityQuery;
}

interface SuccessfulSnap {
  readonly input: CarLocalityInput;
  readonly point: SnappedRoadPoint;
}

interface FailedSnap {
  readonly input: CarLocalityInput;
  readonly error: string;
}

type DiagnosticRouteStatus = 'routed' | 'no-route' | 'error';

const DIAGNOSTIC_ROUTES: readonly DiagnosticRoute[] = [
  {
    category: 'required',
    from: { postalCode: '8001', city: 'Zürich' },
    to: { postalCode: '3011', city: 'Bern' },
  },
  {
    category: 'required',
    from: { postalCode: '3011', city: 'Bern' },
    to: { postalCode: '8001', city: 'Zürich' },
  },
  {
    category: 'required',
    from: { postalCode: '8750', city: 'Glarus' },
    to: { postalCode: '8001', city: 'Zürich' },
  },
  {
    category: 'required',
    from: { postalCode: '8001', city: 'Zürich' },
    to: { postalCode: '8750', city: 'Glarus' },
  },
  {
    category: 'required',
    from: { postalCode: '3920', city: 'Zermatt' },
    to: { postalCode: '3930', city: 'Visp' },
  },
  {
    category: 'required',
    from: { postalCode: '3930', city: 'Visp' },
    to: { postalCode: '3920', city: 'Zermatt' },
  },
  {
    category: 'border',
    from: { postalCode: '4001', city: 'Basel' },
    to: { postalCode: '3011', city: 'Bern' },
  },
  {
    category: 'border',
    from: { postalCode: '1201', city: 'Genève' },
    to: { postalCode: '1003', city: 'Lausanne' },
  },
  {
    category: 'border',
    from: { postalCode: '8200', city: 'Schaffhausen' },
    to: { postalCode: '8001', city: 'Zürich' },
  },
  {
    category: 'border',
    from: { postalCode: '6830', city: 'Chiasso' },
    to: { postalCode: '6900', city: 'Lugano' },
  },
  {
    category: 'border',
    from: { postalCode: '9470', city: 'Buchs SG' },
    to: { postalCode: '9000', city: 'St. Gallen' },
  },
  {
    category: 'border',
    from: { postalCode: '7562', city: 'Samnaun-Compatsch' },
    to: { postalCode: '7550', city: 'Scuol' },
  },
  {
    category: 'mountain/rural',
    from: { postalCode: '7435', city: 'Splügen' },
    to: { postalCode: '7430', city: 'Thusis' },
  },
  {
    category: 'mountain/rural',
    from: { postalCode: '7132', city: 'Vals' },
    to: { postalCode: '7130', city: 'Ilanz' },
  },
  {
    category: 'mountain/rural',
    from: { postalCode: '2350', city: 'Saignelégier' },
    to: { postalCode: '2800', city: 'Delémont' },
  },
];

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
}

function parseSampleSize(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const sampleSize = Number(value);
  if (!Number.isInteger(sampleSize) || sampleSize < 50) {
    throw new Error('--snap-sample-size must be an integer of at least 50.');
  }
  return sampleSize;
}

function formatCoordinate({ latitude, longitude }: Coordinate): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;
  const parts = [
    ...(hours === 0 ? [] : [`${hours}h`]),
    ...(hours === 0 && minutes === 0 ? [] : [`${minutes}m`]),
    `${remainingSeconds}s`,
  ];
  return `${parts.join(' ')} (${seconds.toFixed(1)} s)`;
}

function formatDistance(meters: number): string {
  return meters >= 1_000
    ? `${(meters / 1_000).toFixed(1)} km (${meters.toFixed(1)} m)`
    : `${meters.toFixed(1)} m`;
}

function formatSnap(point: SnappedRoadPoint): string {
  const road = point.name === undefined ? 'unnamed road' : point.name;
  return `${point.distanceMeters.toFixed(1)} m to ${road} at ${formatCoordinate(point)}`;
}

function localityLabel(locality: Locality | CarLocalityInput): string {
  return `${locality.postalCode} ${locality.city}`;
}

function resolveLocality(
  resolver: LocalityResolver,
  query: LocalityQuery,
): Locality {
  const locality = resolver.resolve(query);
  if (locality === undefined) {
    throw new Error(
      `Unable to resolve locality: ${query.postalCode} ${query.city}.`,
    );
  }
  return locality;
}

function straightLineDistanceMeters(
  from: Coordinate,
  to: Coordinate,
): number {
  const radians = Math.PI / 180;
  const fromLatitude = from.latitude * radians;
  const toLatitude = to.latitude * radians;
  const latitudeDifference = (to.latitude - from.latitude) * radians;
  const longitudeDifference = (to.longitude - from.longitude) * radians;
  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function printLocality(
  heading: string,
  locality: Locality,
  snapped: SnappedRoadPoint,
): void {
  console.log(`${heading}:`);
  console.log(localityLabel(locality));
  console.log(`Locality coordinate: ${formatCoordinate(locality)}`);
  console.log(`Road snap distance: ${snapped.distanceMeters.toFixed(1)} m`);
  console.log(`Snapped coordinate: ${formatCoordinate(snapped)}`);
  console.log(`Road: ${snapped.name ?? '(unnamed)'}`);
}

function printDriving(route: CarRouteEstimate | undefined): void {
  console.log('Driving:');
  if (route === undefined) {
    console.log('NoRoute');
    return;
  }
  console.log(`Duration: ${formatDuration(route.durationSeconds)}`);
  console.log(`Distance: ${formatDistance(route.distanceMeters)}`);
}

async function inspectRoute(
  client: OsrmClient,
  from: Locality,
  to: Locality,
): Promise<{
  readonly fromSnap: SnappedRoadPoint;
  readonly toSnap: SnappedRoadPoint;
  readonly route: CarRouteEstimate | undefined;
}> {
  const [fromSnap, toSnap, route] = await Promise.all([
    client.findNearestRoadPoint(from),
    client.findNearestRoadPoint(to),
    client.estimateCarRoute(from, to),
  ]);
  return { fromSnap, toSnap, route };
}

async function printSingleRoute(
  client: OsrmClient,
  from: Locality,
  to: Locality,
): Promise<void> {
  const { fromSnap, toSnap, route } = await inspectRoute(client, from, to);
  printLocality('From', from, fromSnap);
  console.log('');
  printLocality('To', to, toSnap);
  console.log('');
  printDriving(route);
}

function nearestRank(
  sortedValues: readonly number[],
  fraction: number,
): number {
  const index = Math.max(Math.ceil(sortedValues.length * fraction) - 1, 0);
  return sortedValues[index] ?? 0;
}

function selectEvenSample<T>(
  values: readonly T[],
  requestedSize: number | undefined,
): readonly T[] {
  if (requestedSize === undefined || requestedSize >= values.length) {
    return values;
  }
  if (requestedSize === 1) {
    return values.slice(0, 1);
  }
  return Array.from({ length: requestedSize }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (values.length - 1)) / (requestedSize - 1),
    );
    return values[sourceIndex] as T;
  });
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  transform: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const results: U[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(values[index] as T);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      async () => worker(),
    ),
  );
  return results;
}

async function inspectSnapping(
  client: OsrmClient,
  inputs: readonly CarLocalityInput[],
): Promise<number> {
  console.log(`Snapping representative localities: ${inputs.length}`);
  const results = await mapWithConcurrency(
    inputs,
    SNAP_CONCURRENCY,
    async (input): Promise<SuccessfulSnap | FailedSnap> => {
      try {
        return {
          input,
          point: await client.findNearestRoadPoint(input),
        };
      } catch (error) {
        return {
          input,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  const successful = results.filter(
    (result): result is SuccessfulSnap => 'point' in result,
  );
  const failed = results.filter(
    (result): result is FailedSnap => 'error' in result,
  );
  if (successful.length === 0) {
    console.log('Successful snaps: 0');
    console.log(`Failed snaps: ${failed.length}`);
    console.log('Snap failures:');
    for (const { input, error } of failed) {
      console.log(`  ${localityLabel(input)}: ${error}`);
    }
    return 0;
  }

  const distances = successful
    .map(({ point }) => point.distanceMeters)
    .toSorted((left, right) => left - right);
  const worst = successful.toSorted((left, right) =>
    right.point.distanceMeters !== left.point.distanceMeters
      ? right.point.distanceMeters - left.point.distanceMeters
      : left.input.localityId < right.input.localityId
        ? -1
        : left.input.localityId > right.input.localityId
          ? 1
          : 0,
  );
  const largeSnapCount = successful.filter(
    ({ point }) => point.distanceMeters >= LARGE_SNAP_METERS,
  ).length;

  console.log(`Successful snaps: ${successful.length}`);
  console.log(`Failed snaps: ${failed.length}`);
  console.log(`Minimum snap distance: ${(distances[0] ?? 0).toFixed(1)} m`);
  console.log(
    `Median snap distance: ${nearestRank(distances, 0.5).toFixed(1)} m`,
  );
  console.log(`P95 snap distance: ${nearestRank(distances, 0.95).toFixed(1)} m`);
  console.log(
    `Maximum snap distance: ${(distances.at(-1) ?? 0).toFixed(1)} m`,
  );
  console.log(
    `Very large snaps (>= ${LARGE_SNAP_METERS} m): ${largeSnapCount}`,
  );
  console.log('Ten worst snaps:');
  for (const { input, point } of worst.slice(0, 10)) {
    console.log(
      `  ${localityLabel(input)}: ${formatSnap(point)}`,
    );
  }
  if (failed.length > 0) {
    console.log('Snap failures:');
    for (const { input, error } of failed) {
      console.log(`  ${localityLabel(input)}: ${error}`);
    }
  }
  return successful.length;
}

async function printDiagnosticRoute(
  client: OsrmClient,
  resolver: LocalityResolver,
  diagnostic: DiagnosticRoute,
): Promise<DiagnosticRouteStatus> {
  const from = resolveLocality(resolver, diagnostic.from);
  const to = resolveLocality(resolver, diagnostic.to);
  console.log(
    `[${diagnostic.category}] ${localityLabel(from)} -> ${localityLabel(to)}`,
  );

  try {
    const { fromSnap, toSnap, route } = await inspectRoute(client, from, to);
    console.log(`  From snap: ${formatSnap(fromSnap)}`);
    console.log(`  To snap: ${formatSnap(toSnap)}`);
    if (route === undefined) {
      console.log('  Driving: NoRoute');
      console.log('  Diagnostic: NoRoute');
      return 'no-route';
    }

    const directDistance = straightLineDistanceMeters(from, to);
    const detourFactor = route.distanceMeters / directDistance;
    console.log(`  Duration: ${formatDuration(route.durationSeconds)}`);
    console.log(`  Distance: ${formatDistance(route.distanceMeters)}`);
    console.log(`  Route/straight-line ratio: ${detourFactor.toFixed(2)}x`);

    const diagnostics: string[] = [];
    if (
      fromSnap.distanceMeters >= LARGE_SNAP_METERS ||
      toSnap.distanceMeters >= LARGE_SNAP_METERS
    ) {
      diagnostics.push('very large snap distance');
    }
    if (detourFactor >= SUSPICIOUS_DETOUR_FACTOR) {
      diagnostics.push(
        `suspicious detour (>= ${SUSPICIOUS_DETOUR_FACTOR.toFixed(1)}x straight-line)`,
      );
    }
    console.log(
      `  Diagnostic: ${diagnostics.length === 0 ? 'none flagged' : diagnostics.join('; ')}`,
    );
    return 'routed';
  } catch (error) {
    console.log(
      `  Diagnostic error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'error';
  }
}

async function runDiagnostics(
  client: OsrmClient,
  localities: readonly Locality[],
  sampleSize: number | undefined,
): Promise<void> {
  const resolver = new LocalityResolver(localities);
  const allInputs = buildCarLocalityInputs(localities);
  const sampledInputs = selectEvenSample(allInputs, sampleSize);
  const successfulSnapCount = await inspectSnapping(client, sampledInputs);
  console.log('');
  console.log(
    'Route diagnostics (mechanical detour flags are evidence, not calibration):',
  );
  const routeOutcomes: {
    readonly diagnostic: DiagnosticRoute;
    readonly status: DiagnosticRouteStatus;
  }[] = [];
  for (const diagnostic of DIAGNOSTIC_ROUTES) {
    routeOutcomes.push({
      diagnostic,
      status: await printDiagnosticRoute(client, resolver, diagnostic),
    });
  }
  console.log('');
  console.log(
    'Known limitation: this graph contains Switzerland only. Border routes may be disconnected or suboptimal when real roads briefly leave Switzerland.',
  );

  const failures: string[] = [];
  if (successfulSnapCount < 50) {
    failures.push(
      `only ${successfulSnapCount} locality snaps succeeded; at least 50 are required`,
    );
  }
  const requestErrors = routeOutcomes.filter(
    ({ status }) => status === 'error',
  );
  if (requestErrors.length > 0) {
    failures.push(`${requestErrors.length} route diagnostic request(s) failed`);
  }
  const requiredNoRoutes = routeOutcomes.filter(
    ({ diagnostic, status }) =>
      diagnostic.category === 'required' && status === 'no-route',
  );
  if (requiredNoRoutes.length > 0) {
    failures.push(
      `${requiredNoRoutes.length} required sanity route(s) returned NoRoute`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`Diagnostics incomplete: ${failures.join('; ')}.`);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'from-postal-code': { type: 'string' },
      'from-city': { type: 'string' },
      'to-postal-code': { type: 'string' },
      'to-city': { type: 'string' },
      'localities-file': { type: 'string' },
      'osrm-base-url': { type: 'string' },
      diagnostics: { type: 'boolean', default: false },
      'snap-sample-size': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  const localitiesPath = resolve(
    values['localities-file'] ?? DEFAULT_LOCALITIES_PATH,
  );
  const localities = parseLocalitiesCsv(
    await readFile(localitiesPath, 'utf8'),
  );
  const client = new OsrmClient({ baseUrl: values['osrm-base-url'] });

  if (values.diagnostics) {
    await runDiagnostics(
      client,
      localities,
      parseSampleSize(values['snap-sample-size']),
    );
    return;
  }

  const resolver = new LocalityResolver(localities);
  const from = resolveLocality(resolver, {
    postalCode: requireOption(
      values['from-postal-code'],
      'from-postal-code',
    ),
    city: requireOption(values['from-city'], 'from-city'),
  });
  const to = resolveLocality(resolver, {
    postalCode: requireOption(values['to-postal-code'], 'to-postal-code'),
    city: requireOption(values['to-city'], 'to-city'),
  });
  await printSingleRoute(client, from, to);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
