import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { CommuteRuntime } from '@jm/commute/node';

import type {
  LocalitiesResponse,
  ReachabilityRequest,
  ReachabilityResponse,
} from '../../apps/commute-api/src/api-types.js';
import { createCommuteApiServer } from '../../apps/commute-api/src/server.js';

const LOOPBACK_HOST = '127.0.0.1';
const textDecoder = new TextDecoder();

export const COMMUTE_API_SERVER_TIMING_STAGES = [
  'lookup',
  'join',
  'hex',
  'geojson',
  'serialization',
  'total',
] as const;

export type CommuteApiServerTimingStage =
  (typeof COMMUTE_API_SERVER_TIMING_STAGES)[number];

export type CommuteApiServerTimings = Readonly<
  Record<CommuteApiServerTimingStage, number>
>;

const QUIET_LOGGER = Object.freeze({
  info: (_message: string): void => undefined,
  error: (_message: string, _error?: unknown): void => undefined,
});

export interface RunningCommuteApi {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export interface HttpJsonResult<T> {
  readonly value: T;
  readonly bytes: Uint8Array;
  readonly headers: Headers;
  readonly elapsedMilliseconds: number;
}

/** Strictly parse the stages emitted by successful reachability responses. */
export function parseCommuteApiServerTiming(
  headers: Headers,
): CommuteApiServerTimings {
  const header = headers.get('server-timing');
  if (header === null) {
    throw new Error('Reachability response is missing Server-Timing.');
  }
  const durations = new Map<string, number>();
  for (const entry of header.split(',')) {
    const [rawName, ...rawParameters] = entry.split(';');
    const name = rawName?.trim();
    const durationParameter = rawParameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith('dur='));
    if (name === undefined || durationParameter === undefined) {
      throw new Error(`Malformed Server-Timing entry ${JSON.stringify(entry)}.`);
    }
    const duration = Number(durationParameter.slice('dur='.length));
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(
        `Server-Timing stage ${JSON.stringify(name)} has invalid duration ` +
          `${JSON.stringify(durationParameter)}.`,
      );
    }
    durations.set(name, duration);
  }

  const result = {} as Record<CommuteApiServerTimingStage, number>;
  for (const stage of COMMUTE_API_SERVER_TIMING_STAGES) {
    const duration = durations.get(stage);
    if (duration === undefined) {
      throw new Error(`Server-Timing is missing required stage ${stage}.`);
    }
    result[stage] = duration;
  }
  return result;
}

function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('Commute API did not expose an IP listener address.'));
        return;
      }
      resolve((address as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, LOOPBACK_HOST);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

export async function startCommuteApi(
  runtime: CommuteRuntime,
): Promise<RunningCommuteApi> {
  const server = createCommuteApiServer({
    runtime,
    logger: QUIET_LOGGER,
  });
  const port = await listenOnEphemeralPort(server);
  let closed = false;
  return {
    baseUrl: `http://${LOOPBACK_HOST}:${port}`,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await closeServer(server);
    },
  };
}

async function requireSuccessfulJson<T>(
  url: string,
  init?: RequestInit,
): Promise<HttpJsonResult<T>> {
  const startedAt = performance.now();
  const response = await fetch(url, init);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const elapsedMilliseconds = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} returned HTTP ${response.status}: ` +
        textDecoder.decode(bytes),
    );
  }
  const contentType = response.headers.get('content-type');
  if (contentType?.startsWith('application/json') !== true) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} returned unexpected Content-Type ` +
        `${JSON.stringify(contentType)}.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(textDecoder.decode(bytes));
  } catch (error) {
    throw new Error(`${init?.method ?? 'GET'} ${url} returned invalid JSON.`, {
      cause: error,
    });
  }
  return {
    value: value as T,
    bytes,
    headers: response.headers,
    elapsedMilliseconds,
  };
}

export async function getApiLocalities(
  baseUrl: string,
): Promise<HttpJsonResult<LocalitiesResponse>> {
  return await requireSuccessfulJson(`${baseUrl}/api/localities`);
}

export async function postApiReachability(
  baseUrl: string,
  request: ReachabilityRequest,
): Promise<HttpJsonResult<ReachabilityResponse>> {
  return await requireSuccessfulJson(`${baseUrl}/api/reachability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}
