export type TransitLocationKind = 'STOP' | 'STATION';

export interface TransitLocation {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly kind: TransitLocationKind;
  readonly parentId?: string;
}
