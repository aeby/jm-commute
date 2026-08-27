import type { RaptorTimetable } from '../timetable';
import {
  collectReachablePatterns,
  createReachablePatternScratch,
} from './collect-reachable-patterns';
import { scanPattern } from './scan-pattern';
import {
  createUnreachedArrivalTimes,
  UNREACHED_TIME,
} from './state';
import { relaxTransfers } from './relax-transfers';
import type {
  RaptorDiagnosticsCallback,
  RaptorQuery,
  RaptorResult,
} from './types';

interface ValidatedQuery {
  readonly originStopIndexes: readonly number[];
  readonly departureTimeSeconds: number;
  readonly maxArrivalTime: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

const validateNonnegativeInteger = (
  value: number,
  fieldName: string,
): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a nonnegative integer`);
  }
};

const validateQuery = (
  timetable: RaptorTimetable,
  query: RaptorQuery,
): ValidatedQuery => {
  if (query === null || typeof query !== 'object') {
    throw new TypeError('RAPTOR query must be an object');
  }
  if (!Array.isArray(query.originStopIndexes)) {
    throw new TypeError('originStopIndexes must be an array');
  }
  if (query.originStopIndexes.length === 0) {
    throw new RangeError('originStopIndexes must contain at least one stop');
  }

  const stopCount = timetable.sourceStopIds.length;
  if (timetable.patternOccurrencesByStop.length !== stopCount) {
    throw new Error(
      'Timetable source stops and pattern adjacency have different lengths',
    );
  }
  if (timetable.transfersByStop.length !== stopCount) {
    throw new Error(
      'Timetable source stops and transfer adjacency have different lengths',
    );
  }
  const originMembership = new Uint8Array(stopCount);
  const originStopIndexes: number[] = [];
  for (const originStopIndex of query.originStopIndexes) {
    if (
      !Number.isInteger(originStopIndex) ||
      originStopIndex < 0 ||
      originStopIndex >= stopCount
    ) {
      throw new RangeError(`Invalid origin stop index ${originStopIndex}`);
    }
    if (originMembership[originStopIndex] === 0) {
      originMembership[originStopIndex] = 1;
      originStopIndexes.push(originStopIndex);
    }
  }

  validateNonnegativeInteger(
    query.departureTimeSeconds,
    'departureTimeSeconds',
  );
  if (query.departureTimeSeconds >= UNREACHED_TIME) {
    throw new RangeError(
      `departureTimeSeconds must be less than ${UNREACHED_TIME}`,
    );
  }
  if (
    !Number.isSafeInteger(query.maxTravelTimeSeconds) ||
    query.maxTravelTimeSeconds <= 0
  ) {
    throw new RangeError('maxTravelTimeSeconds must be a positive integer');
  }
  const maxArrivalTime =
    query.departureTimeSeconds + query.maxTravelTimeSeconds;
  if (
    !Number.isSafeInteger(maxArrivalTime) ||
    maxArrivalTime >= UNREACHED_TIME
  ) {
    throw new RangeError(
      'departureTimeSeconds plus maxTravelTimeSeconds exceeds the supported time range',
    );
  }

  validateNonnegativeInteger(query.maxTransfers, 'maxTransfers');
  if (query.maxTransfers >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('maxTransfers is too large');
  }
  validateNonnegativeInteger(
    query.minTransferTimeSeconds,
    'minTransferTimeSeconds',
  );

  return {
    originStopIndexes,
    departureTimeSeconds: query.departureTimeSeconds,
    maxArrivalTime,
    maxTransfers: query.maxTransfers,
    minTransferTimeSeconds: query.minTransferTimeSeconds,
  };
};

export const runRaptorOneToAll = (
  timetable: RaptorTimetable,
  query: RaptorQuery,
  onDiagnostics?: RaptorDiagnosticsCallback,
): RaptorResult => {
  const validated = validateQuery(timetable, query);
  const stopCount = timetable.sourceStopIds.length;
  const globalArrivalTimes = createUnreachedArrivalTimes(stopCount);
  const globalBoardingReadyTimes = createUnreachedArrivalTimes(stopCount);
  const bestVehicleArrivalTimes = createUnreachedArrivalTimes(stopCount);
  let previousRoundArrivalTimes = createUnreachedArrivalTimes(stopCount);
  let previousRoundTransferApplied = new Uint8Array(stopCount);
  let currentRoundArrivalTimes = createUnreachedArrivalTimes(stopCount);
  let currentRoundTransferApplied = new Uint8Array(stopCount);
  const currentRoundVehicleArrivalTimes =
    createUnreachedArrivalTimes(stopCount);
  const vehicleImprovedStops: number[] = [];
  const vehicleImprovedMembership = new Uint8Array(stopCount);

  let markedStops = [...validated.originStopIndexes];
  let nextMarkedStops: number[] = [];
  const nextMarkedMembership = new Uint8Array(stopCount);
  for (const originStopIndex of validated.originStopIndexes) {
    globalArrivalTimes[originStopIndex] = validated.departureTimeSeconds;
    globalBoardingReadyTimes[originStopIndex] =
      validated.departureTimeSeconds;
    previousRoundArrivalTimes[originStopIndex] =
      validated.departureTimeSeconds;
    previousRoundTransferApplied[originStopIndex] = 1;
  }

  const patternScratch = createReachablePatternScratch(
    timetable.patterns.length,
  );
  const maximumRounds = validated.maxTransfers + 1;
  const patternScansPerRound: number[] = [];
  let patternsScanned = 0;
  let stopsImproved = 0;
  let transferEdgesExamined = 0;
  let transferArrivalImprovements = 0;
  let roundsExecuted = 0;

  for (
    let roundNumber = 1;
    roundNumber <= maximumRounds && markedStops.length > 0;
    roundNumber += 1
  ) {
    roundsExecuted += 1;
    const reachablePatternIds = collectReachablePatterns(
      timetable,
      markedStops,
      patternScratch,
    );
    patternScansPerRound.push(reachablePatternIds.length);
    patternsScanned += reachablePatternIds.length;

    for (const patternId of reachablePatternIds) {
      const pattern = timetable.patterns[patternId];
      const firstStopIndex =
        patternScratch.earliestScanIndexByPattern[patternId];
      if (pattern === undefined || firstStopIndex === undefined) {
        throw new Error(`Reachable pattern ${patternId} is unavailable`);
      }
      stopsImproved += scanPattern(pattern, firstStopIndex, {
        globalArrivalTimes,
        globalBoardingReadyTimes,
        bestVehicleArrivalTimes,
        previousRoundArrivalTimes,
        previousRoundTransferApplied,
        currentRoundArrivalTimes,
        currentRoundTransferApplied,
        currentRoundVehicleArrivalTimes,
        vehicleImprovedStops,
        vehicleImprovedMembership,
        transfersByStop: timetable.transfersByStop,
        nextMarkedStops,
        nextMarkedMembership,
        roundNumber,
        minTransferTimeSeconds: validated.minTransferTimeSeconds,
        maxArrivalTime: validated.maxArrivalTime,
      });
    }

    const transferCounts = relaxTransfers({
      transfersByStop: timetable.transfersByStop,
      vehicleImprovedStops,
      currentRoundVehicleArrivalTimes,
      globalArrivalTimes,
      globalBoardingReadyTimes,
      currentRoundArrivalTimes,
      currentRoundTransferApplied,
      nextMarkedStops,
      nextMarkedMembership,
      minTransferTimeSeconds: validated.minTransferTimeSeconds,
      maxArrivalTime: validated.maxArrivalTime,
    });
    transferEdgesExamined += transferCounts.edgesExamined;
    transferArrivalImprovements += transferCounts.arrivalImprovements;

    for (const stopIndex of vehicleImprovedStops) {
      vehicleImprovedMembership[stopIndex] = 0;
      currentRoundVehicleArrivalTimes[stopIndex] = UNREACHED_TIME;
    }
    vehicleImprovedStops.length = 0;

    for (const stopIndex of nextMarkedStops) {
      nextMarkedMembership[stopIndex] = 0;
    }
    const previousMarkedStops = markedStops;
    markedStops = nextMarkedStops;
    nextMarkedStops = previousMarkedStops;
    nextMarkedStops.length = 0;

    const reusableArrivalTimes = previousRoundArrivalTimes;
    previousRoundArrivalTimes = currentRoundArrivalTimes;
    currentRoundArrivalTimes = reusableArrivalTimes;
    currentRoundArrivalTimes.fill(UNREACHED_TIME);
    const reusableTransferApplied = previousRoundTransferApplied;
    previousRoundTransferApplied = currentRoundTransferApplied;
    currentRoundTransferApplied = reusableTransferApplied;
    currentRoundTransferApplied.fill(0);
  }

  onDiagnostics?.({
    roundsExecuted,
    patternsScanned,
    patternScansPerRound,
    stopsImproved,
    transferEdgesExamined,
    transferArrivalImprovements,
  });

  return {
    departureTimeSeconds: validated.departureTimeSeconds,
    arrivalTimes: globalArrivalTimes,
  };
};
