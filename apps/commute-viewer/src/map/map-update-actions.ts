export interface SliderMapUpdateActions {
  readonly updateHexVisibility: () => void;
}

export interface OriginMapUpdateActions {
  readonly updateOriginMarker: () => void;
  readonly updateCamera: () => void;
}

/** Slider interaction is presentation-only and must never touch the camera. */
export function applySliderMapUpdate(
  actions: SliderMapUpdateActions,
): void {
  actions.updateHexVisibility();
}

/** A new origin may update its marker and recenter the map once. */
export function applyOriginMapUpdate(
  actions: OriginMapUpdateActions,
): void {
  actions.updateOriginMarker();
  actions.updateCamera();
}
