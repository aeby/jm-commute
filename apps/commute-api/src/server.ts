import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { performance } from 'node:perf_hooks';

import type {
  CommuteApiRuntime,
  ErrorResponse,
} from './api-types.js';
import {
  DEFAULT_COMMUTE_API_CONFIG,
  type CommuteApiConfig,
} from './config.js';
import {
  createLocalitiesRepresentation,
  etagMatches,
} from './routes/localities.js';
import {
  buildReachabilityResponse,
  parseReachabilityRequest,
  ReachabilityRequestError,
} from './routes/reachability.js';

const LOCALITIES_CACHE_CONTROL =
  'public, max-age=86400, must-revalidate';

export interface CommuteApiLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface CommuteApiServerOptions {
  readonly runtime: CommuteApiRuntime;
  readonly config?: CommuteApiConfig;
  readonly logger?: CommuteApiLogger;
}

export type CommuteApiRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

class HttpRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(serialized);
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  const body: ErrorResponse = { error: { code, message } };
  sendJson(response, statusCode, body, {
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
): void {
  if (allowedOrigins.length === 0) {
    return;
  }
  response.setHeader('Vary', 'Origin');
  const requestOrigin = request.headers.origin;
  if (requestOrigin !== undefined && allowedOrigins.includes(requestOrigin)) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }
}

function handlePreflight(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigins: readonly string[],
  allowedMethods: string,
): void {
  const requestOrigin = request.headers.origin;
  if (
    requestOrigin !== undefined &&
    !allowedOrigins.includes(requestOrigin)
  ) {
    sendError(
      response,
      403,
      'CORS_ORIGIN_NOT_ALLOWED',
      'The request origin is not allowed.',
    );
    return;
  }
  response.writeHead(204, {
    'Access-Control-Allow-Methods': allowedMethods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Content-Length': '0',
  });
  response.end();
}

function contentTypeIsJson(request: IncomingMessage): boolean {
  const contentType = request.headers['content-type'];
  return (
    typeof contentType === 'string' &&
    contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  );
}

async function readJsonBody(
  request: IncomingMessage,
  maximumBytes: number,
): Promise<unknown> {
  if (!contentTypeIsJson(request)) {
    throw new HttpRequestError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json.',
    );
  }
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined) {
    const declaredBytes = Number(contentLength);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > maximumBytes
    ) {
      throw new HttpRequestError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        `Request body must not exceed ${maximumBytes} bytes.`,
      );
    }
  }

  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > maximumBytes) {
      throw new HttpRequestError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        `Request body must not exceed ${maximumBytes} bytes.`,
      );
    }
    chunks.push(bytes);
  }
  if (byteLength === 0) {
    throw new HttpRequestError(
      400,
      'INVALID_JSON',
      'Request body must contain a JSON object.',
    );
  }

  try {
    return JSON.parse(Buffer.concat(chunks, byteLength).toString('utf8'));
  } catch {
    throw new HttpRequestError(
      400,
      'INVALID_JSON',
      'Request body must contain valid JSON.',
    );
  }
}

function methodNotAllowed(
  response: ServerResponse,
  allowedMethods: string,
): void {
  sendError(
    response,
    405,
    'METHOD_NOT_ALLOWED',
    'The requested HTTP method is not allowed for this endpoint.',
    { Allow: allowedMethods },
  );
}

/** Build a testable request handler around an already initialized runtime. */
export function createCommuteApiRequestHandler(
  options: CommuteApiServerOptions,
): CommuteApiRequestHandler {
  const config = options.config ?? DEFAULT_COMMUTE_API_CONFIG;
  const logger = options.logger ?? console;
  const localities = createLocalitiesRepresentation(options.runtime);

  return async (request, response): Promise<void> => {
    applyCorsHeaders(request, response, config.corsAllowedOrigins);

    let pathname: string;
    try {
      pathname = new URL(request.url ?? '/', 'http://commute-api.local').pathname;
    } catch {
      sendError(response, 400, 'INVALID_URL', 'Request URL is invalid.');
      return;
    }

    try {
      if (
        request.method === 'OPTIONS' &&
        (pathname === '/api/localities' || pathname === '/api/reachability')
      ) {
        const allowedMethods =
          pathname === '/api/localities' ?
            'GET, OPTIONS' :
            'POST, OPTIONS';
        handlePreflight(
          request,
          response,
          config.corsAllowedOrigins,
          allowedMethods,
        );
        return;
      }

      if (pathname === '/health') {
        if (request.method !== 'GET') {
          methodNotAllowed(response, 'GET');
          return;
        }
        sendJson(
          response,
          200,
          {
            status: 'ok',
            localityCount: options.runtime.localities.all().length,
          },
          { 'Cache-Control': 'no-store' },
        );
        return;
      }

      if (pathname === '/api/localities') {
        if (request.method !== 'GET') {
          methodNotAllowed(response, 'GET, OPTIONS');
          return;
        }
        const responseHeaders = {
          'Cache-Control': LOCALITIES_CACHE_CONTROL,
          ETag: localities.etag,
        };
        if (etagMatches(request.headers['if-none-match'], localities.etag)) {
          response.writeHead(304, responseHeaders);
          response.end();
          return;
        }
        sendJson(response, 200, localities.body, responseHeaders);
        return;
      }

      if (pathname === '/api/reachability') {
        if (request.method !== 'POST') {
          methodNotAllowed(response, 'POST, OPTIONS');
          return;
        }
        const requestStartedAt = performance.now();
        const body = await readJsonBody(
          request,
          config.maxRequestBodyBytes,
        );
        const parsed = parseReachabilityRequest(body, options.runtime);
        const result = buildReachabilityResponse(
          options.runtime,
          parsed,
          config.visualization,
        );
        const serializationStartedAt = performance.now();
        const serialized = JSON.stringify(result.response);
        const serializationMs = performance.now() - serializationStartedAt;
        const totalMs = performance.now() - requestStartedAt;
        const serverTiming = [
          `lookup;dur=${result.timings.lookupMs.toFixed(2)}`,
          `join;dur=${result.timings.coordinateJoinMs.toFixed(2)}`,
          `hex;dur=${result.timings.hexAggregationMs.toFixed(2)}`,
          `geojson;dur=${result.timings.geoJsonConstructionMs.toFixed(2)}`,
          `serialization;dur=${serializationMs.toFixed(2)}`,
          `total;dur=${totalMs.toFixed(2)}`,
        ].join(', ');
        logger.info(
          `[commute-api] origin=${parsed.originLocalityId} ` +
            `mode=${parsed.mode} maxMinutes=${parsed.maxTravelMinutes} ` +
            `reachable=${result.response.reachableLocalityCount} ` +
            `hexes=${result.response.hexagonCount} ` +
            `lookupMs=${result.timings.lookupMs.toFixed(2)} ` +
            `joinMs=${result.timings.coordinateJoinMs.toFixed(2)} ` +
            `hexMs=${result.timings.hexAggregationMs.toFixed(2)} ` +
            `geoJsonMs=${result.timings.geoJsonConstructionMs.toFixed(2)} ` +
            `serializationMs=${serializationMs.toFixed(2)} ` +
            `totalMs=${totalMs.toFixed(2)}`,
        );
        sendJson(response, 200, serialized, {
          'Cache-Control': 'no-store',
          'Server-Timing': serverTiming,
        });
        return;
      }

      sendError(response, 404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      if (error instanceof HttpRequestError) {
        sendError(response, error.statusCode, error.code, error.message);
        return;
      }
      if (error instanceof ReachabilityRequestError) {
        sendError(response, 400, error.code, error.message);
        return;
      }
      logger.error('[commute-api] Request handling failed.', error);
      if (!response.headersSent) {
        sendError(
          response,
          500,
          'INTERNAL_SERVER_ERROR',
          'The request could not be completed.',
        );
      } else {
        response.destroy();
      }
    }
  };
}

export function createCommuteApiServer(
  options: CommuteApiServerOptions,
): Server {
  return createServer(createCommuteApiRequestHandler(options));
}
