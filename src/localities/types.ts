export type LocalityId = string;

export interface LocalityQuery {
  readonly postalCode: string;
  readonly city: string;
}

export interface Locality {
  readonly postalCode: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Transport-independent commute result keyed by the application's locality ID.
 */
export interface ReachableLocality {
  readonly localityId: LocalityId;
  readonly travelMinutes: number;
}
