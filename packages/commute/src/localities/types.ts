export type LocalityId = string;

export interface LocalityQuery {
  readonly postalCode: string;
  readonly city: string;
}

export interface Locality {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
}

/** A transport-independent commute result keyed by canonical locality ID. */
export interface ReachableLocality {
  readonly localityId: LocalityId;
  readonly travelMinutes: number;
}
