/**
 * Returns whether a complete fastest-window label should replace the current one.
 *
 * A shorter duration wins. Equal durations prefer leaving later, followed by
 * arriving earlier as the final deterministic tie-breaker.
 */
export const isPreferredFastestJourney = (
  durationSeconds: number,
  departureTimeSeconds: number,
  arrivalTimeSeconds: number,
  currentDurationSeconds: number,
  currentDepartureTimeSeconds: number,
  currentArrivalTimeSeconds: number,
): boolean =>
  durationSeconds < currentDurationSeconds ||
  (durationSeconds === currentDurationSeconds &&
    (departureTimeSeconds > currentDepartureTimeSeconds ||
      (departureTimeSeconds === currentDepartureTimeSeconds &&
        arrivalTimeSeconds < currentArrivalTimeSeconds)));
