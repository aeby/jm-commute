import { USE_QUERY_TRANSFER_TIME } from '../transfer-encoding';
import type { GtfsTransferType } from '../../prepare/gtfs/types';
import {
  type TransferEdge,
} from './types';

const validateStopIndex = (
  stopIndex: number,
  stopCount: number,
  label: string,
): void => {
  if (
    !Number.isInteger(stopIndex) ||
    stopIndex < 0 ||
    stopIndex >= stopCount
  ) {
    throw new RangeError(`${label} stop index ${stopIndex} is out of bounds.`);
  }
};

const validateDuration = (duration: number): void => {
  if (
    !Number.isInteger(duration) ||
    duration < 0 ||
    duration > USE_QUERY_TRANSFER_TIME
  ) {
    throw new RangeError(
      'Transfer duration must be a nonnegative Uint32 integer.',
    );
  }
};

const mergeExplicitDurations = (left: number, right: number): number => {
  if (left === USE_QUERY_TRANSFER_TIME) {
    return right;
  }
  if (right === USE_QUERY_TRANSFER_TIME) {
    return left;
  }
  return Math.max(left, right);
};

type SupportedAllowedGtfsTransferType = Extract<GtfsTransferType, 0 | 1 | 2>;

export class TransferEdgeRegistry {
  readonly #stopCount: number;
  readonly #edges = new Map<number, TransferEdge>();
  readonly #forbiddenPairs = new Set<number>();

  public constructor(stopCount: number) {
    if (!Number.isInteger(stopCount) || stopCount < 0) {
      throw new RangeError('stopCount must be a nonnegative integer.');
    }
    this.#stopCount = stopCount;
  }

  #pairKey(fromStopIndex: number, toStopIndex: number): number {
    validateStopIndex(fromStopIndex, this.#stopCount, 'Origin');
    validateStopIndex(toStopIndex, this.#stopCount, 'Destination');
    return fromStopIndex * this.#stopCount + toStopIndex;
  }

  public addExplicitEdge(
    fromStopIndex: number,
    toStopIndex: number,
    minimumTransferTimeSeconds: number,
    transferType: SupportedAllowedGtfsTransferType,
  ): void {
    validateDuration(minimumTransferTimeSeconds);
    const key = this.#pairKey(fromStopIndex, toStopIndex);
    if (this.#forbiddenPairs.has(key)) {
      throw new Error(
        `Contradictory allowed and forbidden transfer rules for ${fromStopIndex} → ${toStopIndex}.`,
      );
    }

    const existing = this.#edges.get(key);
    if (existing === undefined) {
      this.#edges.set(key, {
        fromStopIndex,
        toStopIndex,
        minimumTransferTimeSeconds,
        accessEligible: transferType === 2,
      });
      return;
    }

    this.#edges.set(key, {
      ...existing,
      minimumTransferTimeSeconds: mergeExplicitDurations(
        existing.minimumTransferTimeSeconds,
        minimumTransferTimeSeconds,
      ),
      accessEligible: existing.accessEligible || transferType === 2,
    });
  }

  public addExplicitForbidden(
    fromStopIndex: number,
    toStopIndex: number,
  ): void {
    const key = this.#pairKey(fromStopIndex, toStopIndex);
    if (this.#edges.has(key)) {
      throw new Error(
        `Contradictory allowed and forbidden transfer rules for ${fromStopIndex} → ${toStopIndex}.`,
      );
    }
    this.#forbiddenPairs.add(key);
  }

  public addGeneratedEdge(
    fromStopIndex: number,
    toStopIndex: number,
    minimumTransferTimeSeconds: number,
  ): void {
    validateDuration(minimumTransferTimeSeconds);
    const key = this.#pairKey(fromStopIndex, toStopIndex);
    if (this.#forbiddenPairs.has(key) || this.#edges.has(key)) {
      return;
    }
    this.#edges.set(key, {
      fromStopIndex,
      toStopIndex,
      minimumTransferTimeSeconds,
      accessEligible: true,
    });
  }

  #toTransfersByStop(
    include: (edge: TransferEdge) => boolean,
  ): readonly Uint32Array[] {
    const edgesByStop: TransferEdge[][] = Array.from(
      { length: this.#stopCount },
      () => [],
    );
    for (const edge of this.#edges.values()) {
      if (include(edge)) {
        edgesByStop[edge.fromStopIndex]?.push(edge);
      }
    }

    return edgesByStop.map((edges) => {
      edges.sort(
        (left, right) =>
          left.toStopIndex - right.toStopIndex ||
          left.minimumTransferTimeSeconds -
            right.minimumTransferTimeSeconds,
      );
      const flattened = new Uint32Array(edges.length * 2);
      edges.forEach((edge, index) => {
        flattened[index * 2] = edge.toStopIndex;
        flattened[index * 2 + 1] = edge.minimumTransferTimeSeconds;
      });
      return flattened;
    });
  }

  public toTransfersByStop(): readonly Uint32Array[] {
    return this.#toTransfersByStop(() => true);
  }

  public toAccessTransfersByStop(): readonly Uint32Array[] {
    return this.#toTransfersByStop(({ accessEligible }) => accessEligible);
  }
}
