import type { Locality } from '@jm/commute';
import type { CarRoadGraphMetadata } from '@commute-internal/car/road-graph-metadata';

export type RoadGraphMetadata = CarRoadGraphMetadata;

export interface PreparedData {
  readonly localities: readonly Locality[];
  readonly roadGraph: RoadGraphMetadata;
}

export interface RoadPreparedDataManifest {
  readonly schemaVersion: 1;
  readonly roadGraph: RoadGraphMetadata;
}

export interface OsrmPreparationConfig {
  readonly image: string;
  readonly version: string;
  readonly profile: 'car.lua';
  readonly algorithm: 'ch';
  readonly datasetBasename: string;
}
