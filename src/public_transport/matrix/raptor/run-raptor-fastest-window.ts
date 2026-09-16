import type { PublicTransportNetwork } from '../../network';
import { collectValidatedOriginDepartureSlots } from './collect-origin-departure-slots';
import { isPreferredFastestJourney } from './fastest-journey-policy';
import {
  createRaptorRunBuffers,
  runValidatedRaptorOneToAllBorrowed,
  type RaptorSharedRangeContext,
} from './run-raptor-one-to-all';
import {
  createUnreachedArrivalTimes,
  UNREACHED_TIME,
} from './state';
import type { FastestWindowQuery, FastestWindowResult } from './types';
import {
  createValidatedRaptorRunQuery,
  validateFastestWindowQuery,
} from './validate-query';

const createSharedRangeContext = (
  stopCount: number,
  maximumRounds: number,
): RaptorSharedRangeContext => ({
  rounds: Array.from({ length: maximumRounds + 1 }, () => ({
    vehicleArrivalTimes: createUnreachedArrivalTimes(stopCount),
    changedVehicleStops: [],
    boardingReadyTimes: createUnreachedArrivalTimes(stopCount),
    changedBoardingReadyStops: [],
  })),
});

/**
 * Processes meaningful origin departures latest-to-earliest. If a later
 * departure already reaches a stop no later with the same maximum number of
 * vehicle legs, an earlier-departure arrival is dominated: it leaves earlier,
 * arrives no sooner, and therefore cannot have a shorter duration. Shared
 * round-aware absolute-arrival labels prune precisely those cases.
 */
export const runRaptorFastestWindow = (
  timetable: PublicTransportNetwork,
  query: FastestWindowQuery,
): FastestWindowResult => {
  const validated = validateFastestWindowQuery(timetable, query);
  const departureSlots = collectValidatedOriginDepartureSlots(
    timetable,
    validated,
  );
  const stopCount = timetable.sourceStopIds.length;
  const durationSeconds = createUnreachedArrivalTimes(stopCount);
  const departureTimes = createUnreachedArrivalTimes(stopCount);
  const arrivalTimes = createUnreachedArrivalTimes(stopCount);
  const maximumRounds = validated.maxTransfers + 1;
  const sharedContext = createSharedRangeContext(stopCount, maximumRounds);
  const buffers = createRaptorRunBuffers(timetable);

  for (const departureTimeSeconds of departureSlots) {
    const runResult = runValidatedRaptorOneToAllBorrowed(
      timetable,
      createValidatedRaptorRunQuery(validated, departureTimeSeconds),
      buffers,
      sharedContext,
    );

    for (const stopIndex of buffers.reachedStops) {
      const arrival = runResult.arrivalTimes[stopIndex] ?? UNREACHED_TIME;
      if (arrival === UNREACHED_TIME || arrival < departureTimeSeconds) {
        continue;
      }
      const duration = arrival - departureTimeSeconds;
      if (
        isPreferredFastestJourney(
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
      }
    }
  }

  return { durationSeconds, departureTimes, arrivalTimes };
};
