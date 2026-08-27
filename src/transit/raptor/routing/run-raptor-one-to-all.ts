import type { RaptorTimetable } from '../timetable';
import {
  collectInitialAccessStops,
  createInitialAccessScratch,
  type InitialAccessScratch,
} from './collect-initial-access-stops';
import {
  collectReachablePatterns,
  createReachablePatternScratch,
  type ReachablePatternScratch,
} from './collect-reachable-patterns';
import { scanPattern } from './scan-pattern';
import {
  createUnreachedArrivalTimes,
  improveSharedBoardingReadyTime,
  UNREACHED_TIME,
  type SharedRoundArrivalState,
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

export interface RaptorRunBuffers {
  readonly stopCount: number;
  readonly patternCount: number;
  readonly globalArrivalTimes: Uint32Array;
  readonly reachedStops: number[];
  readonly reachedMembership: Uint8Array;
  readonly globalBoardingReadyTimes: Uint32Array;
  readonly bestVehicleArrivalTimes: Uint32Array;
  readonly roundArrivalTimesA: Uint32Array;
  readonly roundArrivalTimesB: Uint32Array;
  readonly roundTransferAppliedA: Uint8Array;
  readonly roundTransferAppliedB: Uint8Array;
  readonly currentRoundVehicleArrivalTimes: Uint32Array;
  readonly vehicleImprovedStops: number[];
  readonly vehicleImprovedMembership: Uint8Array;
  readonly markedStopsA: number[];
  readonly markedStopsB: number[];
  readonly nextMarkedMembership: Uint8Array;
  readonly patternScratch: ReachablePatternScratch;
  readonly initialAccessScratch: InitialAccessScratch;
}

export interface RaptorSharedRangeContext {
  readonly rounds: readonly SharedRoundArrivalState[];
}

export const createRaptorRunBuffers = (
  timetable: RaptorTimetable,
): RaptorRunBuffers => {
  const stopCount = timetable.sourceStopIds.length;
  return {
    stopCount,
    patternCount: timetable.patterns.length,
    globalArrivalTimes: createUnreachedArrivalTimes(stopCount),
    reachedStops: [],
    reachedMembership: new Uint8Array(stopCount),
    globalBoardingReadyTimes: createUnreachedArrivalTimes(stopCount),
    bestVehicleArrivalTimes: createUnreachedArrivalTimes(stopCount),
    roundArrivalTimesA: createUnreachedArrivalTimes(stopCount),
    roundArrivalTimesB: createUnreachedArrivalTimes(stopCount),
    roundTransferAppliedA: new Uint8Array(stopCount),
    roundTransferAppliedB: new Uint8Array(stopCount),
    currentRoundVehicleArrivalTimes:
      createUnreachedArrivalTimes(stopCount),
    vehicleImprovedStops: [],
    vehicleImprovedMembership: new Uint8Array(stopCount),
    markedStopsA: [],
    markedStopsB: [],
    nextMarkedMembership: new Uint8Array(stopCount),
    patternScratch: createReachablePatternScratch(timetable.patterns.length),
    initialAccessScratch: createInitialAccessScratch(stopCount),
  };
};

const resetMarkedStopBuffers = (
  buffers: RaptorRunBuffers,
  markedStops: number[],
): void => {
  for (const stopIndex of markedStops) {
    buffers.roundArrivalTimesA[stopIndex] = UNREACHED_TIME;
    buffers.roundArrivalTimesB[stopIndex] = UNREACHED_TIME;
    buffers.roundTransferAppliedA[stopIndex] = 0;
    buffers.roundTransferAppliedB[stopIndex] = 0;
    buffers.nextMarkedMembership[stopIndex] = 0;
  }
  markedStops.length = 0;
};

const resetRunBuffers = (
  timetable: RaptorTimetable,
  buffers: RaptorRunBuffers,
): void => {
  if (
    buffers.stopCount !== timetable.sourceStopIds.length ||
    buffers.patternCount !== timetable.patterns.length
  ) {
    throw new Error('Reusable RAPTOR buffers do not match the timetable.');
  }
  for (const stopIndex of buffers.reachedStops) {
    buffers.globalArrivalTimes[stopIndex] = UNREACHED_TIME;
    buffers.globalBoardingReadyTimes[stopIndex] = UNREACHED_TIME;
    buffers.bestVehicleArrivalTimes[stopIndex] = UNREACHED_TIME;
    buffers.reachedMembership[stopIndex] = 0;
  }
  buffers.reachedStops.length = 0;
  for (const stopIndex of buffers.vehicleImprovedStops) {
    buffers.currentRoundVehicleArrivalTimes[stopIndex] = UNREACHED_TIME;
    buffers.vehicleImprovedMembership[stopIndex] = 0;
  }
  buffers.vehicleImprovedStops.length = 0;
  resetMarkedStopBuffers(buffers, buffers.markedStopsA);
  resetMarkedStopBuffers(buffers, buffers.markedStopsB);
};

const initializeSharedRound = (
  sharedContext: RaptorSharedRangeContext | undefined,
  roundNumber: number,
): SharedRoundArrivalState | undefined => {
  if (sharedContext === undefined) {
    return undefined;
  }
  const previous = sharedContext.rounds[roundNumber - 1];
  const current = sharedContext.rounds[roundNumber];
  if (previous === undefined || current === undefined) {
    throw new Error(
      `Shared Range-RAPTOR labels do not contain round ${roundNumber}.`,
    );
  }
  for (const stopIndex of previous.changedVehicleStops) {
    const arrival =
      previous.vehicleArrivalTimes[stopIndex] ?? UNREACHED_TIME;
    if (
      arrival <
      (current.vehicleArrivalTimes[stopIndex] ?? UNREACHED_TIME)
    ) {
      current.vehicleArrivalTimes[stopIndex] = arrival;
      current.changedVehicleStops.push(stopIndex);
    }
  }
  previous.changedVehicleStops.length = 0;
  for (const stopIndex of previous.changedBoardingReadyStops) {
    const boardingReadyTime =
      previous.boardingReadyTimes[stopIndex] ?? UNREACHED_TIME;
    if (
      boardingReadyTime <
      (current.boardingReadyTimes[stopIndex] ?? UNREACHED_TIME)
    ) {
      current.boardingReadyTimes[stopIndex] = boardingReadyTime;
      current.changedBoardingReadyStops.push(stopIndex);
    }
  }
  previous.changedBoardingReadyStops.length = 0;
  return current;
};

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
  if (timetable.accessTransfersByStop.length !== stopCount) {
    throw new Error(
      'Timetable source stops and initial-access adjacency have different lengths',
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

export const runRaptorOneToAllWithBuffers = (
  timetable: RaptorTimetable,
  query: RaptorQuery,
  buffers: RaptorRunBuffers,
  sharedContext?: RaptorSharedRangeContext,
  onDiagnostics?: RaptorDiagnosticsCallback,
): RaptorResult => {
  const validated = validateQuery(timetable, query);
  resetRunBuffers(timetable, buffers);
  const {
    globalArrivalTimes,
    reachedStops,
    reachedMembership,
    globalBoardingReadyTimes,
    bestVehicleArrivalTimes,
    currentRoundVehicleArrivalTimes,
    vehicleImprovedStops,
    vehicleImprovedMembership,
    nextMarkedMembership,
    patternScratch,
  } = buffers;
  let previousRoundArrivalTimes = buffers.roundArrivalTimesA;
  let previousRoundTransferApplied = buffers.roundTransferAppliedA;
  let currentRoundArrivalTimes = buffers.roundArrivalTimesB;
  let currentRoundTransferApplied = buffers.roundTransferAppliedB;

  const initialAccess = collectInitialAccessStops(
    timetable.accessTransfersByStop,
    validated.originStopIndexes,
    validated.departureTimeSeconds,
    validated.minTransferTimeSeconds,
    validated.maxArrivalTime,
    buffers.initialAccessScratch,
  );
  let markedStops = buffers.markedStopsA;
  let nextMarkedStops = buffers.markedStopsB;
  const sharedRoundZero = sharedContext?.rounds[0];
  if (sharedContext !== undefined && sharedRoundZero === undefined) {
    throw new Error('Shared Range-RAPTOR labels do not contain round zero.');
  }
  for (const { stopIndex, arrivalTimeSeconds } of initialAccess.stops) {
    markedStops.push(stopIndex);
    if (reachedMembership[stopIndex] === 0) {
      reachedMembership[stopIndex] = 1;
      reachedStops.push(stopIndex);
    }
    globalArrivalTimes[stopIndex] = arrivalTimeSeconds;
    globalBoardingReadyTimes[stopIndex] = arrivalTimeSeconds;
    previousRoundArrivalTimes[stopIndex] = arrivalTimeSeconds;
    previousRoundTransferApplied[stopIndex] = 1;
    improveSharedBoardingReadyTime(
      sharedRoundZero,
      stopIndex,
      arrivalTimeSeconds,
    );
  }

  const maximumRounds = validated.maxTransfers + 1;
  if (
    sharedContext !== undefined &&
    sharedContext.rounds.length !== maximumRounds + 1
  ) {
    throw new Error(
      'Shared Range-RAPTOR round count does not match maxTransfers.',
    );
  }
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
    const sharedRound = initializeSharedRound(
      sharedContext,
      roundNumber,
    );
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
        reachedStops,
        reachedMembership,
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
        sharedRound,
      });
    }

    const transferCounts = relaxTransfers({
      transfersByStop: timetable.transfersByStop,
      vehicleImprovedStops,
      currentRoundVehicleArrivalTimes,
      globalArrivalTimes,
      reachedStops,
      reachedMembership,
      globalBoardingReadyTimes,
      currentRoundArrivalTimes,
      currentRoundTransferApplied,
      nextMarkedStops,
      nextMarkedMembership,
      minTransferTimeSeconds: validated.minTransferTimeSeconds,
      maxArrivalTime: validated.maxArrivalTime,
      sharedRound,
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

    const reusableArrivalTimes = previousRoundArrivalTimes;
    previousRoundArrivalTimes = currentRoundArrivalTimes;
    currentRoundArrivalTimes = reusableArrivalTimes;
    const reusableTransferApplied = previousRoundTransferApplied;
    previousRoundTransferApplied = currentRoundTransferApplied;
    currentRoundTransferApplied = reusableTransferApplied;
    for (const stopIndex of nextMarkedStops) {
      currentRoundArrivalTimes[stopIndex] = UNREACHED_TIME;
      currentRoundTransferApplied[stopIndex] = 0;
    }
    nextMarkedStops.length = 0;
  }

  // The last executed round may have produced labels for a round beyond the
  // configured vehicle-leg limit. They are not scanned, but must be cleared
  // before the buffers are reused by the next departure slot.
  for (const stopIndex of markedStops) {
    previousRoundArrivalTimes[stopIndex] = UNREACHED_TIME;
    previousRoundTransferApplied[stopIndex] = 0;
  }
  markedStops.length = 0;

  const lastSharedRound = sharedContext?.rounds[maximumRounds];
  if (lastSharedRound !== undefined) {
    lastSharedRound.changedVehicleStops.length = 0;
    lastSharedRound.changedBoardingReadyStops.length = 0;
  }

  onDiagnostics?.({
    roundsExecuted,
    patternsScanned,
    patternScansPerRound,
    stopsImproved,
    transferEdgesExamined,
    transferArrivalImprovements,
    originalSeedStops: initialAccess.originalStopCount,
    additionalInitialAccessStops: initialAccess.additionalStopCount,
    initialAccessEdgesExamined: initialAccess.edgesExamined,
    initialAccessArrivalImprovements: initialAccess.arrivalImprovements,
  });

  return {
    departureTimeSeconds: validated.departureTimeSeconds,
    arrivalTimes: globalArrivalTimes,
  };
};
