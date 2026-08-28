import { createHash } from 'node:crypto';

import type { TransitTravelTimeManifest } from '@core/transit/travel-time-manifest';

export const RUNTIME_TRANSIT_MATRIX_BYTES = Uint8Array.from([0, 20, 25, 0]);
export const RUNTIME_TRANSIT_MATRIX_SHA256 = createHash('sha256')
  .update(RUNTIME_TRANSIT_MATRIX_BYTES)
  .digest('hex');

export function runtimeTransitManifest(
  matrixSha256 = RUNTIME_TRANSIT_MATRIX_SHA256,
): TransitTravelTimeManifest {
  return {
    mode: 'TRANSIT',
    matrix: {
      schemaVersion: 1,
      localityCount: 2,
      localityIds: ['A', 'B'],
      maxTravelMinutes: 240,
      layout: 'ROW_MAJOR',
      valueEncoding: 'UINT8',
      unit: 'MINUTES',
      unavailableValue: 255,
      matrixByteLength: RUNTIME_TRANSIT_MATRIX_BYTES.byteLength,
      matrixSha256,
    },
    source: {
      serviceDate: '2026-09-07',
      morningWindow: { start: '07:00:00', end: '09:00:00' },
      gtfsFeedVersion: '20260826',
      routingDataFingerprint: 'a'.repeat(64),
      timetableFingerprint: 'b'.repeat(64),
      localityRoutingIndexSha256: 'c'.repeat(64),
      routingPolicy: {
        maxTransfers: 5,
        minTransferTimeSeconds: 120,
        virtualTransfersEnabled: false,
      },
    },
  };
}

export function runtimeTransitManifestBytes(
  value: unknown = runtimeTransitManifest(),
): Uint8Array {
  return Buffer.from(`\n${JSON.stringify(value, null, 3)}\n`, 'utf8');
}
