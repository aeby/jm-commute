export interface TransitPlace {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly stopIds: readonly string[];
}
