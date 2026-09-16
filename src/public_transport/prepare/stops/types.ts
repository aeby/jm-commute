export type TransitStopKind = 'STOP_OR_PLATFORM' | 'STATION';

export interface TransitStop {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly kind: TransitStopKind;
  readonly parentStationId?: string;
}
