import type { RaptorTimetable } from '../timetable';
import { collectOriginDepartureSlots } from './collect-origin-departure-slots';
import {
  createRaptorRunBuffers,
  runRaptorOneToAllWithBuffers,
  type RaptorSharedRangeContext,
} from './run-raptor-one-to-all';
import {
  createUnreachedArrivalTimes,
  UNREACHED_TIME,
} from './state';
import type {
  FastestWindowDiagnosticsCallback,
  FastestWindowQuery,
  FastestWindowResult,
  RaptorRoutingDiagnostics,
} from './types';

const validateNonnegativeInteger = (
  value: number,
  fieldName: string,
): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a nonnegative integer.`);
  }
};

const validateQuery = (query: FastestWindowQuery): void => {
  if (query === null || typeof query !== 'object') {
    throw new TypeError('Fastest-window query must be an object.');
  }
  if (
    !Number.isSafeInteger(query.maxTravelTimeSeconds) ||
    query.maxTravelTimeSeconds <= 0
  ) {
    throw new RangeError('maxTravelTimeSeconds must be a positive integer.');
  }
  validateNonnegativeInteger(query.maxTransfers, 'maxTransfers');
  if (query.maxTransfers >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('maxTransfers is too large.');
  }
  validateNonnegativeInteger(
    query.minTransferTimeSeconds,
    'minTransferTimeSeconds',
  );
  if (
    query.windowEndSeconds - 1 + query.maxTravelTimeSeconds >=
    UNREACHED_TIME
  ) {
    throw new RangeError(
      'Morning-window end plus maxTravelTimeSeconds exceeds the supported time range.',
    );
  }
};

const createSharedRangeContext = (
  stopCount: number,
  maximumRounds: number,
): RaptorSharedRangeContext => ({
  rounds: Array.from({ length: maximumRounds + 1 }, () => ({
    vehicleArrivalTimes: createUnreachedArrivalTimes(stopCount),
    changedVehicleStops: [],
    boardingReadyTimes: createUnreachedArrivalTimes(stopCount),
    changedBoardingReadyStops: [],
    crossRunPrunes: 0,
  })),
});

const shouldReplaceBest = (
  duration: number,
  departure: number,
  arrival: number,
  bestDuration: number,
  bestDeparture: number,
  bestArrival: number,
): boolean =>
  duration < bestDuration ||
  (duration === bestDuration &&
    (departure > bestDeparture ||
      (departure === bestDeparture && arrival < bestArrival)));

/**
 * Processes meaningful origin departures latest-to-earliest. If a later
 * departure already reaches a stop no later with the same maximum number of
 * vehicle legs, an earlier-departure arrival is dominated: it leaves earlier,
 * arrives no sooner, and therefore cannot have a shorter duration. Shared
 * round-aware absolute-arrival labels prune precisely those cases.
 */
export const runRaptorFastestWindow = (
  timetable: RaptorTimetable,
  query: FastestWindowQuery,
  onDiagnostics?: FastestWindowDiagnosticsCallback,
): FastestWindowResult => {
  validateQuery(query);
  const departureSlots = collectOriginDepartureSlots(
    timetable,
    query.originStopIndexes,
    query.windowStartSeconds,
    query.windowEndSeconds,
    query.minTransferTimeSeconds,
  );
  const stopCount = timetable.sourceStopIds.length;
  const durationSeconds = createUnreachedArrivalTimes(stopCount);
  const departureTimes = createUnreachedArrivalTimes(stopCount);
  const arrivalTimes = createUnreachedArrivalTimes(stopCount);
  const maximumRounds = query.maxTransfers + 1;
  const sharedContext = createSharedRangeContext(stopCount, maximumRounds);
  const buffers = createRaptorRunBuffers(timetable);

  let runsWithoutDurationImprovements = 0;
  let patternsScanned = 0;
  let originalSeedStops = 0;
  let maximumAdditionalInitialAccessStops = 0;
  let initialAccessEdgesExamined = 0;

  for (const departureTimeSeconds of departureSlots) {
    let runDiagnostics: RaptorRoutingDiagnostics | undefined;
    const runResult = runRaptorOneToAllWithBuffers(
      timetable,
      {
        originStopIndexes: query.originStopIndexes,
        departureTimeSeconds,
        maxTravelTimeSeconds: query.maxTravelTimeSeconds,
        maxTransfers: query.maxTransfers,
        minTransferTimeSeconds: query.minTransferTimeSeconds,
      },
      buffers,
      sharedContext,
      (value) => {
        runDiagnostics = value;
      },
    );

    let improvedDuration = false;
    for (const stopIndex of buffers.reachedStops) {
      const arrival = runResult.arrivalTimes[stopIndex] ?? UNREACHED_TIME;
      if (arrival === UNREACHED_TIME || arrival < departureTimeSeconds) {
        continue;
      }
      const duration = arrival - departureTimeSeconds;
      if (
        shouldReplaceBest(
          duration,
          departureTimeSeconds,
          arrival,
          durationSeconds[stopIndex] ?? UNREACHED_TIME,
          departureTimes[stopIndex] ?? 0,
          arrivalTimes[stopIndex] ?? UNREACHED_TIME,
        )
      ) {
        durationSeconds[stopIndex] = duration;
        departureTimes[stopIndex] = departureTimeSeconds;
        arrivalTimes[stopIndex] = arrival;
        improvedDuration = true;
      }
    }
    if (!improvedDuration) {
      runsWithoutDurationImprovements += 1;
    }
    if (runDiagnostics !== undefined) {
      patternsScanned += runDiagnostics.patternsScanned;
      originalSeedStops = runDiagnostics.originalSeedStops;
      maximumAdditionalInitialAccessStops = Math.max(
        maximumAdditionalInitialAccessStops,
        runDiagnostics.additionalInitialAccessStops,
      );
      initialAccessEdgesExamined +=
        runDiagnostics.initialAccessEdgesExamined;
    }
  }

  onDiagnostics?.({
    departureSlotCount: departureSlots.length,
    rangeRuns: departureSlots.length,
    runsWithoutDurationImprovements,
    patternsScanned,
    crossRunPrunes: sharedContext.rounds.reduce(
      (total, round) => total + round.crossRunPrunes,
      0,
    ),
    originalSeedStops,
    maximumAdditionalInitialAccessStops,
    initialAccessEdgesExamined,
  });

  return { durationSeconds, departureTimes, arrivalTimes };
};
