import type {
  RaptorRoutePattern,
  RaptorTimetable,
} from '../transit/raptor/timetable';

const BASE64_CHUNK_SIZE = 0x8000;

const HOST_IS_LITTLE_ENDIAN =
  new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export interface ValidationLocality {
  readonly localityId: string;
  readonly postalCode: string;
  readonly city: string;
}

export interface ValidationLocalityRoutingEntry {
  readonly localityId: string;
  readonly selectionMode:
    | 'WITHIN_ACCESS_RADIUS'
    | 'NEAREST_FALLBACK';
  readonly stopIndexes: readonly number[];
}

export interface ValidationHubCandidate {
  readonly placeId: string;
  readonly name: string;
  readonly distanceMeters: number;
  readonly routeCount: number;
  readonly departureCount: number;
  readonly railRouteCount: number;
  readonly railDepartureCount: number;
}

export interface SerializedValidationTimetable {
  readonly sourceStopIds: readonly string[];
  readonly patternStopOffsetsBase64: string;
  readonly patternStopsBase64: string;
  readonly patternTripCountsBase64: string;
  readonly patternStopTimeOffsetsBase64: string;
  readonly stopTimesBase64: string;
  readonly patternPickupDropOffOffsetsBase64: string;
  readonly pickupDropOffTypesBase64: string;
  readonly patternOccurrenceOffsetsBase64: string;
  readonly patternOccurrenceValuesBase64: string;
  readonly transferOffsetsBase64: string;
  readonly transferValuesBase64: string;
}

export interface SwissCommuteValidationData {
  readonly schemaVersion: 1;
  readonly feedVersion: string;
  readonly serviceDate: string;
  readonly departureTime: string;
  readonly localities: readonly ValidationLocality[];
  readonly localityRoutingEntries: readonly ValidationLocalityRoutingEntry[];
  readonly hubCandidatesByLocality: Readonly<
    Record<string, readonly ValidationHubCandidate[]>
  >;
  readonly timetable: SerializedValidationTimetable;
}

export interface DecodedValidationTimetable {
  readonly sourceStopIds: readonly string[];
  readonly patternStopOffsets: Uint32Array;
  readonly patternStops: Uint32Array;
  readonly patternTripCounts: Uint32Array;
  readonly patternStopTimeOffsets: Uint32Array;
  readonly stopTimes: Uint32Array;
  readonly patternPickupDropOffOffsets: Uint32Array;
  readonly pickupDropOffTypes: Uint8Array;
  readonly patternOccurrenceOffsets: Uint32Array;
  readonly patternOccurrenceValues: Uint32Array;
  readonly transferOffsets: Uint32Array;
  readonly transferValues: Uint32Array;
}

declare global {
  interface Window {
    __SWISS_COMMUTE_VALIDATION_DATA__?: SwissCommuteValidationData;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch (error) {
    throw new Error('Validation timetable contains malformed Base64 data.', {
      cause: error,
    });
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeUint8ArrayBase64(values: Uint8Array): string {
  return bytesToBase64(values);
}

export function decodeUint8ArrayBase64(value: string): Uint8Array {
  return base64ToBytes(value);
}

export function encodeUint32ArrayBase64(values: Uint32Array): string {
  if (HOST_IS_LITTLE_ENDIAN) {
    return bytesToBase64(
      new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
    );
  }

  const bytes = new Uint8Array(values.length * Uint32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => {
    view.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, value, true);
  });
  return bytesToBase64(bytes);
}

export function decodeUint32ArrayBase64(value: string): Uint32Array {
  const bytes = base64ToBytes(value);
  if (bytes.byteLength % Uint32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Base64 Uint32 data byte length must be divisible by four.');
  }
  if (HOST_IS_LITTLE_ENDIAN) {
    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }

  const values = new Uint32Array(bytes.byteLength / 4);
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  values.forEach((_, index) => {
    values[index] = view.getUint32(index * Uint32Array.BYTES_PER_ELEMENT, true);
  });
  return values;
}

function flattenUint32Arrays(
  arrays: readonly Uint32Array[],
): { readonly offsets: Uint32Array; readonly values: Uint32Array } {
  const offsets = new Uint32Array(arrays.length + 1);
  let totalLength = 0;
  arrays.forEach((array, index) => {
    totalLength += array.length;
    if (totalLength > 0xffff_ffff) {
      throw new RangeError('Flattened Uint32 data exceeds supported offsets.');
    }
    offsets[index + 1] = totalLength;
  });

  const values = new Uint32Array(totalLength);
  arrays.forEach((array, index) => {
    values.set(array, offsets[index]);
  });
  return { offsets, values };
}

function flattenUint8Arrays(
  arrays: readonly Uint8Array[],
): { readonly offsets: Uint32Array; readonly values: Uint8Array } {
  const offsets = new Uint32Array(arrays.length + 1);
  let totalLength = 0;
  arrays.forEach((array, index) => {
    totalLength += array.length;
    if (totalLength > 0xffff_ffff) {
      throw new RangeError('Flattened Uint8 data exceeds supported offsets.');
    }
    offsets[index + 1] = totalLength;
  });

  const values = new Uint8Array(totalLength);
  arrays.forEach((array, index) => {
    values.set(array, offsets[index]);
  });
  return { offsets, values };
}

export function serializeValidationTimetable(
  timetable: RaptorTimetable,
): SerializedValidationTimetable {
  if (
    timetable.patternOccurrencesByStop.length !==
      timetable.sourceStopIds.length ||
    timetable.transfersByStop.length !== timetable.sourceStopIds.length
  ) {
    throw new Error('Timetable stop and adjacency counts must match.');
  }

  const patternStops = flattenUint32Arrays(
    timetable.patterns.map(({ stops }) => stops),
  );
  const patternStopTimes = flattenUint32Arrays(
    timetable.patterns.map(({ stopTimes }) => stopTimes),
  );
  const patternPickupDropOff = flattenUint8Arrays(
    timetable.patterns.map(({ pickupDropOffTypes }) => pickupDropOffTypes),
  );
  const patternOccurrences = flattenUint32Arrays(
    timetable.patternOccurrencesByStop,
  );
  const transfers = flattenUint32Arrays(timetable.transfersByStop);

  return {
    sourceStopIds: timetable.sourceStopIds,
    patternStopOffsetsBase64: encodeUint32ArrayBase64(patternStops.offsets),
    patternStopsBase64: encodeUint32ArrayBase64(patternStops.values),
    patternTripCountsBase64: encodeUint32ArrayBase64(
      Uint32Array.from(timetable.patterns, ({ tripCount }) => tripCount),
    ),
    patternStopTimeOffsetsBase64: encodeUint32ArrayBase64(
      patternStopTimes.offsets,
    ),
    stopTimesBase64: encodeUint32ArrayBase64(patternStopTimes.values),
    patternPickupDropOffOffsetsBase64: encodeUint32ArrayBase64(
      patternPickupDropOff.offsets,
    ),
    pickupDropOffTypesBase64: encodeUint8ArrayBase64(
      patternPickupDropOff.values,
    ),
    patternOccurrenceOffsetsBase64: encodeUint32ArrayBase64(
      patternOccurrences.offsets,
    ),
    patternOccurrenceValuesBase64: encodeUint32ArrayBase64(
      patternOccurrences.values,
    ),
    transferOffsetsBase64: encodeUint32ArrayBase64(transfers.offsets),
    transferValuesBase64: encodeUint32ArrayBase64(transfers.values),
  };
}

export function decodeValidationTimetable(
  serialized: SerializedValidationTimetable,
): DecodedValidationTimetable {
  return {
    sourceStopIds: serialized.sourceStopIds,
    patternStopOffsets: decodeUint32ArrayBase64(
      serialized.patternStopOffsetsBase64,
    ),
    patternStops: decodeUint32ArrayBase64(serialized.patternStopsBase64),
    patternTripCounts: decodeUint32ArrayBase64(
      serialized.patternTripCountsBase64,
    ),
    patternStopTimeOffsets: decodeUint32ArrayBase64(
      serialized.patternStopTimeOffsetsBase64,
    ),
    stopTimes: decodeUint32ArrayBase64(serialized.stopTimesBase64),
    patternPickupDropOffOffsets: decodeUint32ArrayBase64(
      serialized.patternPickupDropOffOffsetsBase64,
    ),
    pickupDropOffTypes: decodeUint8ArrayBase64(
      serialized.pickupDropOffTypesBase64,
    ),
    patternOccurrenceOffsets: decodeUint32ArrayBase64(
      serialized.patternOccurrenceOffsetsBase64,
    ),
    patternOccurrenceValues: decodeUint32ArrayBase64(
      serialized.patternOccurrenceValuesBase64,
    ),
    transferOffsets: decodeUint32ArrayBase64(
      serialized.transferOffsetsBase64,
    ),
    transferValues: decodeUint32ArrayBase64(serialized.transferValuesBase64),
  };
}

function validateOffsets(
  name: string,
  offsets: Uint32Array,
  entryCount: number,
  valuesLength: number,
): void {
  if (offsets.length !== entryCount + 1 || offsets[0] !== 0) {
    throw new Error(`${name} offsets have an invalid length or first value.`);
  }
  for (let index = 1; index < offsets.length; index += 1) {
    const previous = offsets[index - 1] ?? 0;
    const current = offsets[index] ?? 0;
    if (current < previous) {
      throw new Error(`${name} offsets must be nondecreasing.`);
    }
  }
  if (offsets.at(-1) !== valuesLength) {
    throw new Error(`${name} final offset does not match its values.`);
  }
}

function subarrayViews<TArray extends Uint8Array | Uint32Array>(
  offsets: Uint32Array,
  values: TArray,
): TArray[] {
  return Array.from({ length: offsets.length - 1 }, (_, index) =>
    values.subarray(offsets[index], offsets[index + 1]) as TArray,
  );
}

export function reconstructValidationTimetable(
  decoded: DecodedValidationTimetable,
): RaptorTimetable {
  const patternCount = decoded.patternTripCounts.length;
  validateOffsets(
    'Pattern-stop',
    decoded.patternStopOffsets,
    patternCount,
    decoded.patternStops.length,
  );
  validateOffsets(
    'Pattern-stop-time',
    decoded.patternStopTimeOffsets,
    patternCount,
    decoded.stopTimes.length,
  );
  validateOffsets(
    'Pattern pickup/drop-off',
    decoded.patternPickupDropOffOffsets,
    patternCount,
    decoded.pickupDropOffTypes.length,
  );
  validateOffsets(
    'Pattern-occurrence',
    decoded.patternOccurrenceOffsets,
    decoded.sourceStopIds.length,
    decoded.patternOccurrenceValues.length,
  );
  validateOffsets(
    'Transfer',
    decoded.transferOffsets,
    decoded.sourceStopIds.length,
    decoded.transferValues.length,
  );

  const patternStops = subarrayViews(
    decoded.patternStopOffsets,
    decoded.patternStops,
  );
  const patternStopTimes = subarrayViews(
    decoded.patternStopTimeOffsets,
    decoded.stopTimes,
  );
  const patternPickupDropOffTypes = subarrayViews(
    decoded.patternPickupDropOffOffsets,
    decoded.pickupDropOffTypes,
  );
  const patterns = Array.from(
    { length: patternCount },
    (_, patternIndex): RaptorRoutePattern => {
      const stops = patternStops[patternIndex] ?? new Uint32Array();
      const stopTimes = patternStopTimes[patternIndex] ?? new Uint32Array();
      const pickupDropOffTypes =
        patternPickupDropOffTypes[patternIndex] ?? new Uint8Array();
      const tripCount = decoded.patternTripCounts[patternIndex] ?? 0;
      if (stopTimes.length !== stops.length * tripCount * 2) {
        throw new Error(
          `Pattern ${patternIndex} stop-time length is inconsistent.`,
        );
      }
      if (
        pickupDropOffTypes.length !== Math.ceil((stops.length * tripCount) / 2)
      ) {
        throw new Error(
          `Pattern ${patternIndex} pickup/drop-off length is inconsistent.`,
        );
      }
      return { stops, stopTimes, pickupDropOffTypes, tripCount };
    },
  );

  return {
    sourceStopIds: decoded.sourceStopIds,
    patterns,
    patternOccurrencesByStop: subarrayViews(
      decoded.patternOccurrenceOffsets,
      decoded.patternOccurrenceValues,
    ),
    transfersByStop: subarrayViews(
      decoded.transferOffsets,
      decoded.transferValues,
    ),
  };
}

export function deserializeValidationTimetable(
  serialized: SerializedValidationTimetable,
): RaptorTimetable {
  return reconstructValidationTimetable(
    decodeValidationTimetable(serialized),
  );
}

export function validationTimetableTypedArrayBytes(
  timetable: RaptorTimetable,
): number {
  return (
    timetable.patterns.reduce(
      (total, pattern) =>
        total +
        pattern.stops.byteLength +
        pattern.stopTimes.byteLength +
        pattern.pickupDropOffTypes.byteLength,
      0,
    ) +
    timetable.patternOccurrencesByStop.reduce(
      (total, values) => total + values.byteLength,
      0,
    ) +
    timetable.transfersByStop.reduce(
      (total, values) => total + values.byteLength,
      0,
    )
  );
}
