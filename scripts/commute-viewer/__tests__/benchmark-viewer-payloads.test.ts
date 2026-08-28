import { describe, expect, it } from 'vitest';

import type { ReachabilityResponse } from '../../../apps/commute-api/src/api-types.js';
import {
  assertViewerPayloadResponse,
  authenticateDecompressedBytes,
  measureViewerPayloadCompression,
  VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES,
} from '../benchmark-viewer-payloads.js';

const response = (): ReachabilityResponse => ({
  origin: {
    localityId: '8001:zurich',
    latitude: 47.372_309,
    longitude: 8.542_467,
  },
  mode: 'car',
  maxTravelMinutes: VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES,
  reachableLocalityCount: 2,
  hexagonCount: 1,
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: '1,2',
        properties: { travelMinutes: 30 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [8.5, 47.3],
              [8.6, 47.3],
              [8.6, 47.4],
              [8.5, 47.3],
            ],
          ],
        },
      },
    ],
  },
  bounds: {
    west: 8.5,
    south: 47.3,
    east: 8.6,
    north: 47.4,
  },
});

describe('viewer payload validation', () => {
  it('accepts an exact 240-minute API result matching the direct runtime', () => {
    expect(() =>
      assertViewerPayloadResponse(response(), {
        originLocalityId: '8001:zurich',
        mode: 'car',
        reachableLocalityCount: 2,
      }),
    ).not.toThrow();
  });

  it('rejects wrong horizons, counts, and GeoJSON feature totals', () => {
    expect(() =>
      assertViewerPayloadResponse(
        { ...response(), maxTravelMinutes: 120 },
        {
          originLocalityId: '8001:zurich',
          mode: 'car',
          reachableLocalityCount: 2,
        },
      ),
    ).toThrow(/exactly 240/i);
    expect(() =>
      assertViewerPayloadResponse(response(), {
        originLocalityId: '8001:zurich',
        mode: 'car',
        reachableLocalityCount: 3,
      }),
    ).toThrow(/direct runtime returned 3/i);
    expect(() =>
      assertViewerPayloadResponse(
        { ...response(), hexagonCount: 2 },
        {
          originLocalityId: '8001:zurich',
          mode: 'car',
          reachableLocalityCount: 2,
        },
      ),
    ).toThrow(/GeoJSON features/i);
  });
});

describe('viewer payload compression', () => {
  it('round-trips gzip and Brotli bytes exactly', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ features: Array.from({ length: 50 }, () => 'repeat') }),
    );
    const result = await measureViewerPayloadCompression(bytes);

    expect(result.rawByteLength).toBe(bytes.byteLength);
    expect(result.rawSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.gzipByteLength).toBeGreaterThan(0);
    expect(result.brotliByteLength).toBeGreaterThan(0);
    expect(result.gzipCompressionMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.gzipDecompressionMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.brotliCompressionMilliseconds).toBeGreaterThanOrEqual(0);
    expect(result.brotliDecompressionMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it('rejects decompressed bytes that differ from the source', () => {
    expect(() =>
      authenticateDecompressedBytes(
        'gzip',
        Uint8Array.of(1, 2, 3),
        Uint8Array.of(1, 2, 4),
      ),
    ).toThrow(/exact API response bytes/i);
  });
});
