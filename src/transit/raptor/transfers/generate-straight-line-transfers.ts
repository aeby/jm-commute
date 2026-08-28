import { haversineDistanceMeters } from '../../places';
import { USE_QUERY_TRANSFER_TIME } from '../transfer-encoding';
import { TransferEdgeRegistry } from './merge-transfer-edges';
import { forEachSpatialTransferCandidate } from './spatial-transfer-grid';
import {
  type ActiveTransferStop,
  type StraightLineTransferOptions,
} from './types';

export const validateStraightLineTransferOptions = (
  options: StraightLineTransferOptions,
): void => {
  if (
    !Number.isFinite(options.maxDistanceMeters) ||
    options.maxDistanceMeters <= 0
  ) {
    throw new RangeError('maxDistanceMeters must be greater than zero.');
  }
  if (
    !Number.isFinite(options.walkingSpeedKmh) ||
    options.walkingSpeedKmh <= 0
  ) {
    throw new RangeError('walkingSpeedKmh must be greater than zero.');
  }
  if (!Number.isFinite(options.detourFactor) || options.detourFactor < 1) {
    throw new RangeError('detourFactor must be at least one.');
  }
  if (
    !Number.isFinite(options.changePenaltySeconds) ||
    options.changePenaltySeconds < 0
  ) {
    throw new RangeError(
      'changePenaltySeconds must be greater than or equal to zero.',
    );
  }
};

export const calculateStraightLineTransferTimeSeconds = (
  distanceMeters: number,
  options: StraightLineTransferOptions,
): number => {
  validateStraightLineTransferOptions(options);
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError('distanceMeters must be nonnegative and finite.');
  }
  const walkingSpeedMetersPerSecond =
    (options.walkingSpeedKmh * 1000) / 3600;
  const walkingSeconds = Math.round(
    (distanceMeters * options.detourFactor) /
      walkingSpeedMetersPerSecond,
  );
  const transferSeconds = Math.round(
    walkingSeconds + options.changePenaltySeconds,
  );
  if (transferSeconds >= USE_QUERY_TRANSFER_TIME) {
    throw new RangeError('Calculated transfer duration exceeds Uint32 range.');
  }
  return transferSeconds;
};

export const generateStraightLineTransfers = (
  stops: readonly ActiveTransferStop[],
  registry: TransferEdgeRegistry,
  options: StraightLineTransferOptions,
): number => {
  validateStraightLineTransferOptions(options);
  let generated = 0;

  forEachSpatialTransferCandidate(
    stops,
    options.maxDistanceMeters,
    (left, right) => {
      if (
        left.latitude === undefined ||
        left.longitude === undefined ||
        right.latitude === undefined ||
        right.longitude === undefined
      ) {
        return;
      }
      const distanceMeters = haversineDistanceMeters(
        { latitude: left.latitude, longitude: left.longitude },
        { latitude: right.latitude, longitude: right.longitude },
      );
      if (distanceMeters > options.maxDistanceMeters) {
        return;
      }
      const duration = calculateStraightLineTransferTimeSeconds(
        distanceMeters,
        options,
      );
      if (
        registry.addGeneratedEdge(
          left.stopIndex,
          right.stopIndex,
          duration,
          'VIRTUAL',
        )
      ) {
        generated += 1;
      }
      if (
        registry.addGeneratedEdge(
          right.stopIndex,
          left.stopIndex,
          duration,
          'VIRTUAL',
        )
      ) {
        generated += 1;
      }
    },
  );

  return generated;
};
