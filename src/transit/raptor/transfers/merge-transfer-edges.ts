import {
  USE_QUERY_TRANSFER_TIME,
  type GtfsTransferType,
  type TransferEdge,
  type TransferEdgeSource,
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

const explicitDiagnosticSource = (
  transferType: SupportedAllowedGtfsTransferType,
): TransferEdge['diagnosticSource'] => `GTFS_TYPE_${transferType}`;

const diagnosticSourcePriority = (
  source: TransferEdge['diagnosticSource'],
): number => {
  switch (source) {
    case 'GTFS_TYPE_2':
      return 2;
    case 'GTFS_TYPE_1':
      return 1;
    default:
      return 0;
  }
};

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
  ): 'ADDED' | 'MERGED' {
    validateDuration(minimumTransferTimeSeconds);
    const key = this.#pairKey(fromStopIndex, toStopIndex);
    if (this.#forbiddenPairs.has(key)) {
      throw new Error(
        `Contradictory allowed and forbidden transfer rules for ${fromStopIndex} → ${toStopIndex}.`,
      );
    }

    const existing = this.#edges.get(key);
    if (existing === undefined || existing.source !== 'EXPLICIT') {
      this.#edges.set(key, {
        fromStopIndex,
        toStopIndex,
        minimumTransferTimeSeconds,
        source: 'EXPLICIT',
        accessEligibility:
          transferType === 2 ? 'ACCESS_ELIGIBLE' : 'TRANSFER_ONLY',
        diagnosticSource: explicitDiagnosticSource(transferType),
      });
      return 'ADDED';
    }

    this.#edges.set(key, {
      ...existing,
      minimumTransferTimeSeconds: mergeExplicitDurations(
        existing.minimumTransferTimeSeconds,
        minimumTransferTimeSeconds,
      ),
      accessEligibility:
        existing.accessEligibility === 'ACCESS_ELIGIBLE' || transferType === 2
          ? 'ACCESS_ELIGIBLE'
          : 'TRANSFER_ONLY',
      diagnosticSource:
        diagnosticSourcePriority(existing.diagnosticSource) >= transferType
          ? existing.diagnosticSource
          : explicitDiagnosticSource(transferType),
    });
    return 'MERGED';
  }

  public addExplicitForbidden(
    fromStopIndex: number,
    toStopIndex: number,
  ): boolean {
    const key = this.#pairKey(fromStopIndex, toStopIndex);
    if (this.#edges.get(key)?.source === 'EXPLICIT') {
      throw new Error(
        `Contradictory allowed and forbidden transfer rules for ${fromStopIndex} → ${toStopIndex}.`,
      );
    }
    this.#edges.delete(key);
    const wasPresent = this.#forbiddenPairs.has(key);
    this.#forbiddenPairs.add(key);
    return !wasPresent;
  }

  public addGeneratedEdge(
    fromStopIndex: number,
    toStopIndex: number,
    minimumTransferTimeSeconds: number,
    source: Exclude<TransferEdgeSource, 'EXPLICIT'>,
  ): boolean {
    validateDuration(minimumTransferTimeSeconds);
    const key = this.#pairKey(fromStopIndex, toStopIndex);
    if (this.#forbiddenPairs.has(key) || this.#edges.has(key)) {
      return false;
    }
    this.#edges.set(key, {
      fromStopIndex,
      toStopIndex,
      minimumTransferTimeSeconds,
      source,
      accessEligibility: 'ACCESS_ELIGIBLE',
      diagnosticSource:
        source === 'SIBLING'
          ? 'GENERATED_SIBLING'
          : 'GENERATED_VIRTUAL',
    });
    return true;
  }

  public hasEdge(fromStopIndex: number, toStopIndex: number): boolean {
    return this.#edges.has(this.#pairKey(fromStopIndex, toStopIndex));
  }

  public getEdge(
    fromStopIndex: number,
    toStopIndex: number,
  ): TransferEdge | undefined {
    return this.#edges.get(this.#pairKey(fromStopIndex, toStopIndex));
  }

  public get edgeCount(): number {
    return this.#edges.size;
  }

  public get explicitEdgeCount(): number {
    let count = 0;
    for (const edge of this.#edges.values()) {
      if (edge.source === 'EXPLICIT') {
        count += 1;
      }
    }
    return count;
  }

  public get forbiddenPairCount(): number {
    return this.#forbiddenPairs.size;
  }

  public get accessEdgeCount(): number {
    let count = 0;
    for (const edge of this.#edges.values()) {
      if (edge.accessEligibility === 'ACCESS_ELIGIBLE') {
        count += 1;
      }
    }
    return count;
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
    return this.#toTransfersByStop(
      ({ accessEligibility }) => accessEligibility === 'ACCESS_ELIGIBLE',
    );
  }

  public toEdgeDiagnostics(): readonly TransferEdge[] {
    return [...this.#edges.values()].toSorted(
      (left, right) =>
        left.fromStopIndex - right.fromStopIndex ||
        left.toStopIndex - right.toStopIndex ||
        left.minimumTransferTimeSeconds - right.minimumTransferTimeSeconds,
    );
  }
}
