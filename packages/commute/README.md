# `@jm/commute`

Precompiled Swiss commute reachability for Node.js.

The package authenticates and loads a canonical Swiss locality catalog plus
deterministic locality-to-locality UInt8 matrices for car and public-transit
travel. Production lookups require no OSM, OSRM, GTFS, or RAPTOR data or
processes.

Included data:

- 4,073 official locality records with canonical IDs and representative
  coordinates (©swisstopo);
- an OpenStreetMap/OSRM-derived car matrix;
- a representative-morning Swiss GTFS/RAPTOR-derived transit matrix.

Both directional matrices store whole minutes from 0 through 240 in dense
row-major UInt8 form; 255 means unavailable within four hours.

```ts
import { loadCommuteRuntime } from '@jm/commute/node';

const commute = await loadCommuteRuntime();

const zurich = commute.localities.resolve({
  postalCode: '8001',
  city: 'Zürich',
});

const reachableByCar = commute.car.getReachableLocalities(
  '8001:zurich',
  60,
);
const reachableByTransit = commute.transit.getReachableLocalities(
  zurich?.localityId ?? '8001:zurich',
  60,
);
```

The checked-in source tree does not contain generated matrices. Before building
or packing from this repository, publish the authenticated assets with:

```sh
npm run commute:package:data
```
