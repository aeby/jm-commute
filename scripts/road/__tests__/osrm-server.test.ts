import { describe, expect, it } from 'vitest';

import { createOsrmServerDockerArguments } from '../osrm-server';

describe('local OSRM server', () => {
  it('serves the prepared network from the pinned container', () => {
    expect(
      createOsrmServerDockerArguments(
        {
          image: 'example/osrm:1.2.3',
          algorithm: 'ch',
          datasetBasename: 'switzerland.osrm',
          networkDirectory: '/project/data/processed/road/network',
        },
        'road-osrm-fixture',
      ),
    ).toEqual([
      'run',
      '--rm',
      '--name',
      'road-osrm-fixture',
      '--network',
      'host',
      '--mount',
      'type=bind,source=/project/data/processed/road/network,target=/data,readonly',
      'example/osrm:1.2.3',
      'osrm-routed',
      '--algorithm',
      'ch',
      '/data/switzerland.osrm',
    ]);
  });
});
