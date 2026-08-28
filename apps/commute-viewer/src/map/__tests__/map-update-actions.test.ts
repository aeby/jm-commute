import { describe, expect, it, vi } from 'vitest';

import {
  applyOriginMapUpdate,
  applySliderMapUpdate,
} from '../map-update-actions';

describe('commute map update actions', () => {
  it('allows an origin change to update the marker and camera once', () => {
    const updateOriginMarker = vi.fn<() => void>();
    const updateCamera = vi.fn<() => void>();

    applyOriginMapUpdate({ updateOriginMarker, updateCamera });

    expect(updateOriginMarker).toHaveBeenCalledOnce();
    expect(updateCamera).toHaveBeenCalledOnce();
  });

  it('updates only hex visibility for a slider change', () => {
    const updateHexVisibility = vi.fn<() => void>();
    const updateCamera = vi.fn<() => void>();
    const actions = { updateHexVisibility, updateCamera };

    applySliderMapUpdate(actions);

    expect(updateHexVisibility).toHaveBeenCalledOnce();
    expect(updateCamera).not.toHaveBeenCalled();
  });
});
