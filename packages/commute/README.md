# `@jobmate/commute`

A small, read-only lookup package for precomputed Swiss travel times.

```sh
npm install @jobmate/commute
```

The package is ESM-only and requires Node.js 20 or newer. It has no runtime
dependencies. Its installed size is about 34 MB, almost all of which is the
two embedded travel-time matrices.

It loads one ordered locality array and two dense `UInt8` matrices:

- `road`, generated from OpenStreetMap with OSRM;
- `public_transport`, generated from Swiss GTFS data with RAPTOR.

The package does not perform routing. Matrix values are whole minutes from 0
through 240; 255 means that the destination is unavailable within four hours.

```ts
import { loadCommuteRuntime } from '@jobmate/commute/node';

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

The values are estimates for a dated routing scenario, not live traffic or
live timetable results. Inspect the packaged manifests under `data/` when the
snapshot date matters.

## Data sources and attribution

- Road travel times are derived from OpenStreetMap data: © OpenStreetMap
  contributors, available under the Open Database License (ODbL) 1.0.
- Public-transport travel times are based on the Swiss GTFS feed obtained from
  [opentransportdata.swiss](https://opentransportdata.swiss/).
- Locality names and coordinates come from the official directory published
  by Bundesamt für Landestopografie swisstopo.

See [DATA_SOURCES.md](./DATA_SOURCES.md) for source links, applicable terms,
and redistribution details. The original package software is available under
the MIT License. Copies or substantial portions must retain Jobmate's copyright
and license notice.

## Building from this repository

Before building or packing from this repository, assemble the generated data
with:

```sh
npm run commute:package:data
```

From the repository root, `npm run commute:package:verify` builds the package,
runs its tests and typecheck, installs the exact tarball into a temporary
consumer project, and performs a real lookup against both packaged matrices.
See the repository's `PUBLISHING.md` before publishing a version.
