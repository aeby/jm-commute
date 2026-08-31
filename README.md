# JM Commute

Precomputed travel times between 4,073 Swiss localities.

The repository has a deliberately asymmetric design: generating the matrices
contains the routing complexity; consuming them is a direct array lookup.

```text
OpenStreetMap ─→ road/ ────────────────→ road matrix ───────────────┐
                                                                   │
Swiss GTFS ────→ public_transport/ ────→ public_transport matrix ──┼─→ runtime/
                                                                   │      │
official localities CSV ────────────────────────────────────────────┘      ▼
                                                                    @jm/commute
                                                                         │
                                                                         ▼
                                                                    API + viewer
```

## Repository shape

```text
src/
  public_transport/
    prepare/
    network/
    matrix/
  road/
    prepare/
    network/
    matrix/
  runtime/
    matrix-artifact.ts

packages/commute/
  src/
    localities.ts
    matrix.ts
    runtime.ts
    node.ts

apps/
  commute-api/
  commute-viewer/
```

Both generators follow the same visible flow:

```text
prepare data → build network → calculate travel times
```

The standalone package follows a smaller one:

```text
load data → resolve locality → look up travel time
```

## Commands

```sh
npm install

npm run public-transport:prepare
npm run public-transport:matrix

npm run road:prepare
npm run road:matrix

npm run commute:package:data
npm run commute:package:build
npm run commute:package:pack

npm test
npm run typecheck
npm run lint
```

Preparation and matrix commands skip complete outputs. Pass `-- --restart` to
replace an output or incompatible checkpoint intentionally.

## Generated artifacts

The two generators publish finished artifacts directly under `data/runtime`:

```text
data/runtime/
  localities.json
  public_transport/
    manifest.json
    travel-times.bin
  road/
    manifest.json
    travel-times.bin
```

`travel-times.bin` is a dense, directional, row-major `UInt8` matrix. The
position of each locality in `localities.json` is its row and column index.
Values `0` through `240` are whole travel minutes; `255` means unavailable
within four hours.

The locality array is the sole index. Its count and IDs are not repeated in
either manifest. A manifest is operational metadata only:

```json
{
  "date": "2026-08-31T11:43:01.642Z",
  "fingerprint": "…matrix SHA-256…",
  "source": {
    "dataset": "…short source description…"
  }
}
```

`npm run commute:package:data` creates the ordered locality array from the
official CSV, checks that each matrix has exactly `N × N` bytes, and copies the
five finished files into `packages/commute/data`. It does not re-run routing or
maintain a second artifact-validation system.

## Road matrix

Inputs:

```text
data/raw/osm/switzerland-latest.osm.pbf
data/raw/AMTOVZ_CSV_WGS84.csv
```

`npm run road:prepare` runs the pinned OSRM extraction and contraction steps
and writes the routable network to `data/processed/road/network`.

`npm run road:matrix` starts the pinned `osrm-routed` Docker container, waits
for it to become ready, snaps the ordered localities, requests bounded OSRM
table blocks, and stops the container after publishing the matrix. Its
resumable work files live in `data/processed/road/matrix-build` and are removed
after publication.

To use an already-running local or remote OSRM service instead, pass its URL
explicitly:

```sh
npm run road:matrix -- --osrm-base-url http://host:5000
```

## Public-transport matrix

Inputs are the Swiss GTFS files under `data/raw/gtfs` and the same official
locality CSV.

`npm run public-transport:prepare` retains only normalized stops and the
fixed-day trip stream needed for the configured representative morning. The
result lives under `data/processed/public_transport`.

`npm run public-transport:matrix` builds the compact timetable and locality
stop mapping in memory, runs the Range-RAPTOR queries, and writes the final
matrix. Complete origin rows are checkpointed under
`data/processed/public_transport/matrix-build`.

Routing currently represents departures from 07:00 through 09:00 on the
configured service date, with at most five transfers and a four-hour result
horizon. These are compiler concerns and do not cross into the standalone
package.

## Standalone API

`@jm/commute` does not contain OSRM, OpenStreetMap, GTFS, RAPTOR, graph, or
timetable code. Its Node entry point reads the locality array and two matrices,
then exposes one small object:

```ts
import { loadCommuteRuntime } from '@jm/commute/node';

const runtime = await loadCommuteRuntime();
const origin = runtime.resolve({ postalCode: '8001', city: 'Zürich' });
const destination = runtime.resolve({ postalCode: '3011', city: 'Bern' });

if (origin && destination) {
  runtime.travelTime(origin, destination, 'road');
  runtime.travelTime(origin, destination, 'public_transport');
}
```

`resolve` accepts either a canonical locality ID or a postal-code/city query.
The additional `reachableLocalities(origin, maximum, mode)` row scan is kept
for the map viewer.

Loading performs only checks that give useful failure modes: locality JSON
must be readable and structurally usable, and each matrix must contain exactly
one byte for every origin/destination pair. Manifests are not parsed during
lookups.

## API and viewer

The Node API converts standalone reachability results to map-ready GeoJSON; the
Vue viewer remains a presentation-only HTTP client.

```sh
npm run commute:api:dev
npm run viewer:dev
```

The HTTP mode values are the same as the standalone package:
`public_transport` and `road`. The browser receives locality and GeoJSON data,
never matrix bytes or routing internals.
