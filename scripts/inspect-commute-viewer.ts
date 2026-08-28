import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { loadGeneratedCommuteViewerData } from '../apps/commute-viewer/src/data/runtime-data';
import { calculateVisibleMapBounds } from '../apps/commute-viewer/src/map/map-bounds';
import {
  buildReachabilityHexes,
  extractReachableStopSamples,
  reachabilityHexesToFeatureCollection,
} from '../apps/commute-viewer/src/map/reachability-hexes';
import { VIEWER_CONFIG } from '../apps/commute-viewer/src/config';
import { createBrowserViewerRoutingEngine } from '../apps/commute-viewer/src/viewer-routing';
import { resolveFastestReachableLocalitiesDebug } from '../src/transit/locality-routing';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const GENERATED_DATA_PATH = resolve(
  PROJECT_ROOT,
  'apps/commute-viewer/public/generated/commute-data.js',
);
const REFERENCE_ORIGINS = [
  {
    localityId: '8001:zurich',
    label: '8001 Zürich',
    expectedLocalityCounts: { 30: 176, 60: 768, 90: 1626 },
  },
  {
    localityId: '3011:bern',
    label: '3011 Bern',
    expectedLocalityCounts: { 30: 128, 60: 630, 90: 1386 },
  },
  {
    localityId: '8750:glarus',
    label: '8750 Glarus',
    expectedLocalityCounts: { 30: 36, 60: 113, 90: 344 },
  },
  {
    localityId: '3920:zermatt',
    label: '3920 Zermatt',
    expectedLocalityCounts: { 30: 4, 60: 9, 90: 19 },
  },
] as const;
const DISPLAY_LIMITS = [30, 60, 90] as const;

const formatMilliseconds = (value: number): string => `${value.toFixed(2)} ms`;

function assertBoundsContainVisibleCells(
  origin: { readonly longitude: number; readonly latitude: number },
  hexes: ReturnType<typeof buildReachabilityHexes>,
  minutes: number,
): { readonly longitudeSpan: number; readonly latitudeSpan: number } {
  const bounds = calculateVisibleMapBounds(origin, hexes, minutes);
  if (
    origin.longitude < bounds.west ||
    origin.longitude > bounds.east ||
    origin.latitude < bounds.south ||
    origin.latitude > bounds.north
  ) {
    throw new Error(`Bounds at ${minutes} minutes omit their origin.`);
  }
  for (const hex of hexes) {
    if (hex.travelMinutes > minutes) {
      continue;
    }
    for (const [longitude, latitude] of hex.polygon) {
      if (
        longitude < bounds.west ||
        longitude > bounds.east ||
        latitude < bounds.south ||
        latitude > bounds.north
      ) {
        throw new Error(
          `Bounds at ${minutes} minutes omit visible hex ${hex.id}.`,
        );
      }
    }
  }
  return {
    longitudeSpan: bounds.east - bounds.west,
    latitudeSpan: bounds.north - bounds.south,
  };
}

async function main(): Promise<void> {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  });
  const dataScriptStart = performance.now();
  await import(pathToFileURL(GENERATED_DATA_PATH).href);
  const dataScriptMilliseconds = performance.now() - dataScriptStart;
  const runtimeStart = performance.now();
  const runtime = loadGeneratedCommuteViewerData();
  const runtimeMilliseconds = performance.now() - runtimeStart;
  const entryById = new Map(
    runtime.localityRoutingIndex.entries.map((entry) => [
      entry.localityId,
      entry,
    ]),
  );
  const localityById = new Map(
    runtime.localities.map((locality) => [locality.localityId, locality]),
  );
  const engine = createBrowserViewerRoutingEngine(runtime);

  console.log(`Generated script evaluation: ${formatMilliseconds(dataScriptMilliseconds)}`);
  console.log(`Runtime validation/reconstruction: ${formatMilliseconds(runtimeMilliseconds)}`);
  console.log(`Feed: ${runtime.feedVersion}`);
  console.log('');

  let bernToZurichMinutes: number | undefined;
  for (const reference of REFERENCE_ORIGINS) {
    const entry = entryById.get(reference.localityId);
    const locality = localityById.get(reference.localityId);
    if (entry === undefined || locality === undefined) {
      throw new Error(`Missing reference locality ${reference.localityId}.`);
    }

    const routingStart = performance.now();
    const result = await engine.run([...entry.stopIndexes]);
    const routingMilliseconds = performance.now() - routingStart;
    const samplingStart = performance.now();
    const samples = extractReachableStopSamples(
      result.durationSeconds,
      runtime.stopCoordinates,
    );
    const samplingMilliseconds = performance.now() - samplingStart;
    const aggregationStart = performance.now();
    const hexes = buildReachabilityHexes(
      samples,
      VIEWER_CONFIG.visualization.hexCellDiameterMeters,
    );
    const aggregationMilliseconds = performance.now() - aggregationStart;
    const geoJsonStart = performance.now();
    const featureCollection = reachabilityHexesToFeatureCollection(hexes);
    const geoJsonMilliseconds = performance.now() - geoJsonStart;
    const reachableLocalities = resolveFastestReachableLocalitiesDebug(
      result,
      runtime.localityRoutingIndex,
    );
    const localityCountsByLimit = new Map(
      DISPLAY_LIMITS.map((minutes) => [
        minutes,
        reachableLocalities.filter(
          ({ travelMinutes }) => travelMinutes <= minutes,
        ).length,
      ]),
    );

    const boundsByLimit = new Map(
      DISPLAY_LIMITS.map((minutes) => [
        minutes,
        assertBoundsContainVisibleCells(locality, hexes, minutes),
      ]),
    );
    const thirtyMinuteBounds = boundsByLimit.get(30);
    const ninetyMinuteBounds = boundsByLimit.get(90);
    if (
      thirtyMinuteBounds === undefined ||
      ninetyMinuteBounds === undefined ||
      ninetyMinuteBounds.longitudeSpan < thirtyMinuteBounds.longitudeSpan ||
      ninetyMinuteBounds.latitudeSpan < thirtyMinuteBounds.latitudeSpan
    ) {
      throw new Error(`${reference.label} 90-minute bounds did not grow.`);
    }

    console.log(reference.label);
    console.log(`  RAPTOR: ${formatMilliseconds(routingMilliseconds)}`);
    console.log(`  Stop sampling: ${formatMilliseconds(samplingMilliseconds)}`);
    console.log(`  Hex aggregation: ${formatMilliseconds(aggregationMilliseconds)}`);
    console.log(`  GeoJSON generation: ${formatMilliseconds(geoJsonMilliseconds)}`);
    console.log(`  Full GeoJSON features: ${featureCollection.features.length}`);
    for (const minutes of DISPLAY_LIMITS) {
      const stopCount = samples.filter(
        ({ travelMinutes }) => travelMinutes <= minutes,
      ).length;
      const hexCount = hexes.filter(
        ({ travelMinutes }) => travelMinutes <= minutes,
      ).length;
      console.log(`  ${minutes} min: ${stopCount} stops, ${hexCount} hexes`);
    }
    console.log(
      `  Locality counts: ${DISPLAY_LIMITS.map((minutes) => `${minutes} min ${String(localityCountsByLimit.get(minutes))}`).join(', ')}`,
    );
    console.log(
      `  Bounds verified: 30 min ${thirtyMinuteBounds.longitudeSpan.toFixed(3)}° × ${thirtyMinuteBounds.latitudeSpan.toFixed(3)}°; 90 min ${ninetyMinuteBounds.longitudeSpan.toFixed(3)}° × ${ninetyMinuteBounds.latitudeSpan.toFixed(3)}°`,
    );

    for (const minutes of DISPLAY_LIMITS) {
      const actualCount = localityCountsByLimit.get(minutes);
      const expectedCount = reference.expectedLocalityCounts[minutes];
      if (actualCount !== expectedCount) {
        throw new Error(
          `${reference.label} locality parity failed at ${minutes} minutes: expected ${expectedCount}, received ${String(actualCount)}.`,
        );
      }
    }

    if (reference.localityId === '3011:bern') {
      bernToZurichMinutes = reachableLocalities.find(
        ({ localityId }) => localityId === '8001:zurich',
      )?.travelMinutes;
    }
    console.log('');
  }

  if (bernToZurichMinutes !== 62) {
    throw new Error(
      `Bern to Zürich parity failed: expected 62 minutes, received ${String(bernToZurichMinutes)}.`,
    );
  }
  console.log('Bern → Zürich parity: 62 min');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
