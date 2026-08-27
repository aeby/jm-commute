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
