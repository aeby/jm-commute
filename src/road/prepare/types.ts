import type { Locality } from '@jobmate/commute';

export interface RoadGraphMetadata {
  readonly sourcePbfSha256: string;
  readonly osrmVersion: string;
  readonly profile: 'car.lua';
  readonly algorithm: 'ch';
}

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
