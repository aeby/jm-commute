import { createHash } from 'node:crypto';

import type { LocalityId } from '@jm/commute';
import { loadCommuteRuntime, type CommuteRuntime } from '@jm/commute/node';

import type {
  CommuteMode,
  ReachabilityResponse,
} from '../../apps/commute-api/src/api-types.js';
import { isMainModule } from '../commute/main-module.js';
import {
  getApiLocalities,
  parseCommuteApiServerTiming,
  postApiReachability,
  startCommuteApi,
} from './api-harness.js';

const REFERENCE_ORIGINS = [
  { localityId: '8001:zurich', label: 'Zürich' },
  { localityId: '3011:bern', label: 'Bern' },
  { localityId: '8750:glarus', label: 'Glarus' },
  { localityId: '3920:zermatt', label: 'Zermatt' },
] as const satisfies readonly {
  readonly localityId: LocalityId;
  readonly label: string;
}[];

const MODES = ['car', 'transit'] as const satisfies readonly CommuteMode[];
const THRESHOLDS = [30, 60, 90, 120] as const;

export interface CommuteApiReachabilityVerification {
  readonly localityId: LocalityId;
  readonly label: string;
  readonly mode: CommuteMode;
  readonly maxTravelMinutes: number;
  readonly reachableLocalityCount: number;
  readonly hexagonCount: number;
  readonly responseByteLength: number;
  readonly requestMilliseconds: number;
}

export interface CommuteApiVerification {
  readonly localityCount: number;
  readonly localityResponseByteLength: number;
  readonly localityEtag: string;
  readonly checks: readonly CommuteApiReachabilityVerification[];
  readonly elapsedMilliseconds: number;
}

function assertEqual(
  actual: unknown,
  expected: unknown,
  description: string,
): void {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, ` +
        `received ${JSON.stringify(actual)}.`,
    );
  }
}

function assertReachabilityEnvelope(
  response: ReachabilityResponse,
  runtime: CommuteRuntime,
  localityId: LocalityId,
  mode: CommuteMode,
  maxTravelMinutes: number,
  expectedReachableCount: number,
): void {
  const origin = runtime.localities.get(localityId);
  if (origin === undefined) {
    throw new Error(`Reference origin ${localityId} is absent from the runtime.`);
  }
  assertEqual(response.origin.localityId, localityId, 'Response origin ID');
  assertEqual(
    response.origin.latitude,
    origin.latitude,
    'Response origin latitude',
  );
  assertEqual(
    response.origin.longitude,
    origin.longitude,
    'Response origin longitude',
  );
  assertEqual(response.mode, mode, 'Response mode');
  assertEqual(
    response.maxTravelMinutes,
    maxTravelMinutes,
    'Response maximum travel minutes',
  );
  assertEqual(
    response.reachableLocalityCount,
    expectedReachableCount,
    'HTTP/direct-runtime reachable count',
  );
  assertEqual(
    response.geojson.type,
    'FeatureCollection',
    'GeoJSON collection type',
  );
  assertEqual(
    response.hexagonCount,
    response.geojson.features.length,
    'Hexagon count',
  );
  if (response.hexagonCount > response.reachableLocalityCount) {
    throw new Error(
      `Response has ${response.hexagonCount} hexagons for only ` +
        `${response.reachableLocalityCount} reachable localities.`,
    );
  }
  const { west, south, east, north } = response.bounds;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west > origin.longitude ||
    east < origin.longitude ||
    south > origin.latitude ||
    north < origin.latitude
  ) {
    throw new Error(
      `Response bounds do not contain origin ${localityId}: ` +
        JSON.stringify(response.bounds),
    );
  }
}

export async function verifyCommuteApi(): Promise<CommuteApiVerification> {
  const startedAt = performance.now();
  const runtime = await loadCommuteRuntime();
  const api = await startCommuteApi(runtime);
  try {
    const localityResult = await getApiLocalities(api.baseUrl);
    const actualLocalities = localityResult.value.localities;
    const expectedLocalities = runtime.localities.all();
    if (!Array.isArray(actualLocalities)) {
      throw new Error('GET /api/localities did not return a localities array.');
    }
    assertEqual(
      actualLocalities.length,
      expectedLocalities.length,
      'GET /api/localities count',
    );
    for (let index = 0; index < expectedLocalities.length; index += 1) {
      const actual = actualLocalities[index];
      const expected = expectedLocalities[index];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(
          `GET /api/localities differs from the runtime catalog at index ` +
            `${index}: ${JSON.stringify(actual)} versus ` +
            `${JSON.stringify(expected)}.`,
        );
      }
    }
    const localityEtag = localityResult.headers.get('etag');
    if (localityEtag === null || !/^"[0-9a-f]{64}"$/u.test(localityEtag)) {
      throw new Error(
        `GET /api/localities returned invalid ETag ${JSON.stringify(localityEtag)}.`,
      );
    }
    const expectedLocalityEtag = `"${createHash('sha256')
      .update(localityResult.bytes)
      .digest('hex')}"`;
    assertEqual(localityEtag, expectedLocalityEtag, 'Locality response ETag');

    const checks: CommuteApiReachabilityVerification[] = [];
    for (const origin of REFERENCE_ORIGINS) {
      for (const mode of MODES) {
        for (const maxTravelMinutes of THRESHOLDS) {
          const expected = runtime[mode].getReachableLocalities(
            origin.localityId,
            maxTravelMinutes,
          );
          const result = await postApiReachability(api.baseUrl, {
            originLocalityId: origin.localityId,
            mode,
            maxTravelMinutes,
          });
          assertReachabilityEnvelope(
            result.value,
            runtime,
            origin.localityId,
            mode,
            maxTravelMinutes,
            expected.length,
          );
          parseCommuteApiServerTiming(result.headers);
          checks.push({
            localityId: origin.localityId,
            label: origin.label,
            mode,
            maxTravelMinutes,
            reachableLocalityCount: result.value.reachableLocalityCount,
            hexagonCount: result.value.hexagonCount,
            responseByteLength: result.bytes.byteLength,
            requestMilliseconds: result.elapsedMilliseconds,
          });
        }
      }
    }

    return {
      localityCount: actualLocalities.length,
      localityResponseByteLength: localityResult.bytes.byteLength,
      localityEtag,
      checks,
      elapsedMilliseconds: performance.now() - startedAt,
    };
  } finally {
    await api.close();
  }
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function printVerification(result: CommuteApiVerification): void {
  console.log('Commute API real-runtime integration: verified');
  console.log(
    `Localities: ${formatInteger(result.localityCount)} entries, ` +
      `${formatInteger(result.localityResponseByteLength)} response bytes, ` +
      `ETag ${result.localityEtag}`,
  );
  for (const origin of REFERENCE_ORIGINS) {
    console.log('');
    console.log(`${origin.label} (${origin.localityId}):`);
    for (const mode of MODES) {
      const values = result.checks.filter(
        (check) =>
          check.localityId === origin.localityId && check.mode === mode,
      );
      console.log(
        `  ${mode}: ` +
          values
            .map(
              (check) =>
                `${check.maxTravelMinutes}m=` +
                `${formatInteger(check.reachableLocalityCount)} localities/` +
                `${formatInteger(check.hexagonCount)} hexes`,
            )
            .join(', '),
      );
    }
  }
  console.log('');
  console.log(
    `${formatInteger(result.checks.length)} POST responses matched direct ` +
      `@jm/commute results in ${result.elapsedMilliseconds.toFixed(2)} ms.`,
  );
}

if (isMainModule(import.meta.url)) {
  verifyCommuteApi()
    .then(printVerification)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
