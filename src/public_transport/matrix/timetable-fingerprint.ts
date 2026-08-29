import { createHash, type Hash } from 'node:crypto';

import type { LocalityRoutingStopIndex } from '../network/localities/types';
import type { PublicTransportNetwork } from '../network/timetable/types';

const FORMAT_PREFIX = 'jm-commute:raptor-timetable-fingerprint:v1';
const LOCALITY_FORMAT_PREFIX =
  'jm-commute:public-transport-locality-index:v1';

function updateUint32(hash: Hash, value: number, description: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${description} must be an unsigned 32-bit integer.`);
  }
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32LE(value, 0);
  hash.update(bytes);
}

function updateString(hash: Hash, value: string, description: string): void {
  const bytes = Buffer.from(value, 'utf8');
  updateUint32(hash, bytes.byteLength, `${description} byte length`);
  hash.update(bytes);
}

function updateUint8Array(hash: Hash, values: Uint8Array): void {
  updateUint32(hash, values.length, 'Uint8 array length');
  hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
}

function updateUint32Array(hash: Hash, values: Uint32Array): void {
  updateUint32(hash, values.length, 'Uint32 array length');
  const canonicalBytes = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    canonicalBytes.writeUInt32LE(values[index] as number, index * 4);
  }
  hash.update(canonicalBytes);
}

function updateAdjacency(
  hash: Hash,
  adjacency: readonly Uint32Array[],
  description: string,
): void {
  updateString(hash, description, `${description} label`);
  updateUint32(hash, adjacency.length, `${description} length`);
  for (const values of adjacency) {
    updateUint32Array(hash, values);
  }
}

/**
 * Fingerprints the exact in-memory RAPTOR compiler state using an explicitly
 * little-endian, length-delimited byte stream. This is build provenance only;
 * RAPTOR arrays are never published as runtime data.
 */
export function createRaptorTimetableFingerprint(
  timetable: PublicTransportNetwork,
): string {
  const hash = createHash('sha256');
  updateString(hash, FORMAT_PREFIX, 'format prefix');

  updateUint32(hash, timetable.sourceStopIds.length, 'source stop count');
  for (const sourceStopId of timetable.sourceStopIds) {
    updateString(hash, sourceStopId, 'source stop ID');
  }

  updateUint32(hash, timetable.patterns.length, 'pattern count');
  for (const pattern of timetable.patterns) {
    updateUint32(hash, pattern.tripCount, 'pattern trip count');
    updateUint32Array(hash, pattern.stops);
    updateUint32Array(hash, pattern.stopTimes);
    updateUint8Array(hash, pattern.pickupDropOffTypes);
  }

  updateAdjacency(
    hash,
    timetable.patternOccurrencesByStop,
    'pattern occurrences',
  );
  updateAdjacency(hash, timetable.transfersByStop, 'transfers');
  updateAdjacency(
    hash,
    timetable.accessTransfersByStop,
    'initial access transfers',
  );
  return hash.digest('hex');
}

/** Fingerprints the exact locality-to-dense-stop mapping used by the matrix. */
export function createLocalityRoutingIndexFingerprint(
  localities: LocalityRoutingStopIndex,
): string {
  const hash = createHash('sha256');
  updateString(hash, LOCALITY_FORMAT_PREFIX, 'format prefix');
  updateUint32(hash, localities.entries.length, 'locality count');
  for (const entry of localities.entries) {
    updateString(hash, entry.localityId, 'locality ID');
    updateUint32Array(hash, entry.stopIndexes);
  }
  return hash.digest('hex');
}
