# `@jm/commute`

A small, read-only lookup package for precomputed Swiss travel times.

It loads one ordered locality array and two dense `UInt8` matrices:

- `road`, generated from OpenStreetMap with OSRM;
- `public_transport`, generated from Swiss GTFS data with RAPTOR.

The package does not perform routing. Matrix values are whole minutes from 0
through 240; 255 means that the destination is unavailable within four hours.

```ts
import { loadCommuteRuntime } from '@jm/commute/node';

const runtime = await loadCommuteRuntime();
const zurich = runtime.resolve({ postalCode: '8001', city: 'Zürich' });
const bern = runtime.resolve({ postalCode: '3011', city: 'Bern' });

if (zurich && bern) {
  const roadMinutes = runtime.travelTime(zurich, bern, 'road');
  const publicTransportMinutes = runtime.travelTime(
    zurich,
    bern,
    'public_transport',
  );
}
```

`runtime.resolve(...)` also accepts a canonical locality ID. The viewer uses
`runtime.reachableLocalities(...)` to scan one matrix row for destinations
within a supplied time limit.

Before building or packing from this repository, assemble the generated data
with:

```sh
npm run commute:package:data
```
