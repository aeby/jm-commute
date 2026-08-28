import type { TransitTravelTimeManifest } from '../travel-time-manifest.js';

export const TRANSIT_MATRIX_BYTES = Uint8Array.from([
  0, 20, 45, 255,
  25, 0, 10, 70,
  50, 12, 0, 180,
  255, 68, 28, 0,
]);

export function transitManifest(
  matrixSha256 = 'a'.repeat(64),
): TransitTravelTimeManifest {
  return {
    mode: 'TRANSIT',
    matrix: {
      schemaVersion: 1,
      localityCount: 4,
      localityIds: ['A', 'B', 'C', 'D'],
      maxTravelMinutes: 240,
      layout: 'ROW_MAJOR',
      valueEncoding: 'UINT8',
      unit: 'MINUTES',
      unavailableValue: 255,
      matrixByteLength: TRANSIT_MATRIX_BYTES.byteLength,
      matrixSha256,
    },
    source: {
      serviceDate: '2026-09-07',
      morningWindow: {
        start: '07:00:00',
        end: '09:00:00',
      },
      gtfsFeedVersion: '20260826',
      routingDataFingerprint: 'b'.repeat(64),
      timetableFingerprint: 'c'.repeat(64),
      localityRoutingIndexSha256: 'd'.repeat(64),
      routingPolicy: {
        maxTransfers: 5,
        minTransferTimeSeconds: 120,
        virtualTransfersEnabled: false,
      },
    },
  };
}
