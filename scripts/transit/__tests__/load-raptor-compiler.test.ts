import { describe, expect, it } from 'vitest';

import { assertMatchingGtfsFeedVersion } from '../load-raptor-compiler';

describe('assertMatchingGtfsFeedVersion', () => {
  it('accepts matching raw and processed feed versions', () => {
    expect(() => {
      assertMatchingGtfsFeedVersion('20260826', '20260826');
    }).not.toThrow();
  });

  it('rejects mismatched raw and processed feed versions', () => {
    expect(() => {
      assertMatchingGtfsFeedVersion('processed-feed', 'raw-feed');
    }).toThrow(/does not match fixed-day routing manifest source feed version/);
  });

  it('rejects a version available from only one input', () => {
    expect(() => {
      assertMatchingGtfsFeedVersion('processed-feed', undefined);
    }).toThrow(/does not match/);
    expect(() => {
      assertMatchingGtfsFeedVersion(undefined, 'raw-feed');
    }).toThrow(/does not match/);
  });

  it('accepts two feeds without version metadata', () => {
    expect(() => {
      assertMatchingGtfsFeedVersion(undefined, undefined);
    }).not.toThrow();
  });
});
