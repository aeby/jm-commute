import type { TransitPlace } from '../places';
import type { TransitPlaceServiceProfile } from '../service-profiles';

export type TransitCandidateSelectionMode =
  | 'WITHIN_ACCESS_RADIUS'
  | 'NEAREST_FALLBACK';

export interface TransitPlaceCandidate {
  readonly place: TransitPlace;
  readonly profile: TransitPlaceServiceProfile;
  readonly distanceMeters: number;
}

export interface TransitPlaceCandidateSelection {
  readonly mode: TransitCandidateSelectionMode;
  readonly candidates: readonly TransitPlaceCandidate[];
}

export interface SelectTransitPlaceCandidatesOptions {
  readonly maxAccessDistanceMeters?: number;
  readonly fallbackCandidateCount?: number;
}
