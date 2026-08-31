# Swiss Commute Reachability

A TypeScript project with offline car and public-transport routing compilers and
a compact runtime for estimating which Swiss localities are mutually reachable.

Users and jobs are identified approximately by postcode and/or city name. The
offline compilers map official localities to transport networks and calculate
travel times around lakes, mountains, valleys, and other geographic obstacles.

## Pipeline

1. Resolve postcode and city names to official locality coordinates.
2. Prepare the transport-specific source data.
3. Build the public-transport or road routing network.
4. Compile deterministic locality-to-locality travel-time matrices.
5. Authenticate those matrices in the production runtime package.
6. Serve locality-based reachability through the API and commute map.

## Current milestone

The current implementation compiles car and representative-morning transit
journeys into deterministic dense locality-to-locality matrices. The
`@jm/commute` workspace package ships those matrices together with the 4,073
official locality records and answers production queries without either
routing engine. A small Node API joins reachable locality IDs to representative
coordinates and serves deterministic GeoJSON to the Vue/MapLibre viewer. The
browser performs presentation and local threshold filtering only.

GTFS station records and their child platforms are grouped into locality-access
places in memory while the offline public-transport matrix is compiled.

Journey reconstruction, transfer chaining, and job matching remain out of scope.

## Module boundaries

The backend/runtime implementation is canonical. Its boundaries are:

- **Canonical server package:** `packages/commute` owns locality identity and
  catalog lookup, the opaque shared dense matrix index, thin car/transit
  façades, and `@jm/commute/node`. Its Node loader authenticates package-relative
  data and exposes one `CommuteRuntime` with `localities`, `car`, and `transit`.
- **Root locality preprocessing:** `src/localities/node.ts` parses the official
  swisstopo CSV and applies its established duplicate policy. The package never
  reads that source file at runtime.
- **Offline compilers:** `src/public_transport/{prepare,network,matrix}` and
  `src/road/{prepare,network,matrix}` own their source normalization, routing
  networks, and direct matrix publication. Both remain outside the runtime
  package.
- **HTTP visualization adapter:** `apps/commute-api` loads the package once and
  owns locality JSON, strict request validation, coordinate joining, hex-grid
  aggregation, GeoJSON, caching headers, and development CORS.
- **Browser/viewer:** `apps/commute-viewer` fetches the locality catalog and one
  complete 240-minute GeoJSON overlay per origin/mode selection. It owns only
  autocomplete, MapLibre presentation, and local duration filtering.

Platform-neutral runtime code is shared where natural, but browser
compatibility is not a constraint on the canonical Node loader or
preprocessing. The implemented ownership rules are recorded in
[`docs/runtime-boundary-audit.md`](docs/runtime-boundary-audit.md).

The implemented package direction is:

```text
backend matching / future UI API
               ↓
          @jm/commute
        exports . and ./node
```

There is no browser package. The viewer calls the small server/API that joins
reachable IDs with the packaged representative coordinates. Presentation
choices such as autocomplete ranking, hex grids, map projection, and GeoJSON
remain outside `@jm/commute`. RAPTOR and OSRM are offline compilers and do not
belong in production runtime data.

## Development

```bash
npm install
npm run test:core
npm run typecheck:runtime
npm run typecheck:core
npm run lint
npm run public-transport:prepare
npm run public-transport:matrix
npm run public-transport:verify
npm run road:prepare
npm run road:matrix
npm run road:verify
npm run commute:package:data
npm run commute:package:build
npm run commute:package:verify
npm run commute:api:typecheck
npm run commute:api:verify
npm run commute:api:benchmark
npm run commute:api:dev
npm run viewer:dev
```

The downloaded source data is stored under `data/raw/` and is not committed to Git. Unit tests use a small local fixture and require no network access.

## Data source

Locality data comes from the official directory of towns and cities published by the Federal Office of Topography swisstopo.

Source attribution: **©swisstopo**

## `@jm/commute` server package

`packages/commute` is the single production owner. Its generated data is:

```text
packages/commute/data/
  localities.json
  car/
    manifest.json
    travel-times.bin
  transit/
    manifest.json
    travel-times.bin
```

`localities.json` contains one immutable record per canonical matrix position:
`localityId`, postal code, official city spelling, latitude, and longitude.
Its ordered-ID SHA-256 is recomputed during loading, and its 4,073 IDs must
match both matrix manifests element by element. The catalog is deterministically
generated from `data/raw/AMTOVZ_CSV_WGS84.csv` as part of:

```bash
npm run commute:package:data
```

That command authenticates the root runtime matrices, rebuilds and
read-back-validates `data/runtime/localities.json`, stages all five package
assets, and proves byte identity after promotion. No routing engine is invoked.
Generated package data and `dist/` remain Git-ignored; the build fails clearly
when the assets have not been published.

Build or independently verify the installed npm tarball with:

```bash
npm run commute:package:build
npm run commute:package:pack
npm run commute:package:verify
```

The verifier installs the actual `.tgz` into a clean temporary npm project—no
workspace symlink—then checks locality resolution, car and transit lookups,
package-relative asset loading, and blocked internal subpaths.

```ts
import { loadCommuteRuntime } from '@jm/commute/node';

const commute = await loadCommuteRuntime();
const zurich = commute.localities.resolve({
  postalCode: '8001',
  city: 'Zürich',
});

if (zurich !== undefined) {
  const reachable = commute.transit.getReachableLocalities(
    zurich.localityId,
    60,
  );
}
```

The package exports only `@jm/commute` and `@jm/commute/node`. It contains no
raw locality CSV, OSM, OSRM, GTFS, RAPTOR, matrix compiler, viewer code, or
visualization policy. The two matrix indexes retain separate locality-ID maps;
sharing that small map was not worth weakening their existing opaque boundary.

## Commute visualization API

`apps/commute-api` is a deliberately small Node HTTP application on top of
`@jm/commute`. The matrices remain package-relative server assets and are never
sent to the browser. No HTTP framework or new runtime dependency is required.

Start the development server on its loopback-only default
`http://127.0.0.1:3001` with:

```bash
npm run commute:api:dev
```

For a compiled start, use `npm run commute:api:start`. `COMMUTE_API_HOST` and
`COMMUTE_API_PORT` override the bind address and port. Development CORS permits
only `http://127.0.0.1:5173` and `http://localhost:5173` by default. Setting
`COMMUTE_API_CORS_ORIGIN` replaces that list with one explicit origin; setting
it to an empty value disables CORS headers.

The server loads one `CommuteRuntime` at startup and exposes:

```text
GET /health
GET /api/localities
POST /api/reachability
```

`GET /api/localities` returns all 4,073 canonical records in matrix order. Its
JSON and SHA-256 ETag are prepared once, with a one-day cache policy and normal
`If-None-Match`/`304` handling.

`POST /api/reachability` accepts exactly:

```json
{
  "originLocalityId": "8001:zurich",
  "mode": "car",
  "maxTravelMinutes": 60
}
```

The mode is `car` or `transit`; the maximum is an integer from 0 through the
full 240-minute matrix horizon. The response joins package reachability results
to canonical representative coordinates, aggregates them into deterministic
Web Mercator hexagons, and returns directly renderable Polygon GeoJSON plus the
origin, counts, and geographic bounds. The normal self result is included, so
even a self-only query naturally produces its origin hex.

The grid is adapted into API ownership from the established viewer algorithm:
pointy-top cells with a 2,000 m opposite-corner diameter, deterministic axial
`q,r` assignment, and a render-only scale of 0.88 for transparent gaps.
Multiple localities in one cell use the minimum travel duration. Grid settings
are server configuration, not request parameters or commute-package concepts.

Reachability responses are currently uncompressed by the built-in server. Each
successful response exposes lookup, coordinate-join, aggregation, GeoJSON,
serialization, and total CPU durations through `Server-Timing`; the server logs
the same concise metrics. Run the real-data checks and wire-size benchmark with:

```bash
npm run commute:api:verify
npm run commute:api:benchmark
```

The Vue viewer consumes these endpoints without importing package or compiler
code and never downloads the matrices.

### Road data

OpenStreetMap provides the source road network. OSRM is an offline compiler
dependency only; production lookup uses the published matrix and requires no
OSRM process, Docker image, or source PBF. The compiler has the same visible
workflow as public transport while keeping the road-specific implementation
smaller:

```text
raw OSM + official localities
  → src/road/prepare
  → src/road/network
  → src/road/matrix
  → data/runtime/car/{manifest.json,travel-times.bin}
```

The stages expose `prepareData`/`loadPreparedData`, `buildNetwork`, and
`calculateTravelTimes` through `src/road/index.ts`. Runtime terminology remains
`car`, which is the public commute mode; `road` names the offline compiler.

Place the Geofabrik Switzerland extract at:

```text
data/raw/osm/switzerland-latest.osm.pbf
```

Prepare the routing data with:

```bash
npm run road:prepare
```

Preparation pins OSRM 26.8.0, the standard `car.lua` profile, and Contraction
Hierarchies. It runs extraction and contraction as one atomic operation and
writes the only persistent compiler input to
`data/processed/road/network/`. Its small manifest records the source-PBF hash
and exact OSRM configuration; extraction-only files unused by CH routing are
discarded. An existing complete dataset is reused unless `-- --restart` is
passed.

Start the prepared service on the loopback interface while compiling a matrix:

```bash
docker run --rm \
  --publish 127.0.0.1:5000:5000 \
  --mount type=bind,source="$PWD/data/processed/road/network",target=/data,readonly \
  ghcr.io/project-osrm/osrm-backend:26.8.0-debian \
  osrm-routed --algorithm ch /data/switzerland.osrm
```

Then generate the complete matrix with:

```bash
npm run road:matrix
```

The command authenticates the prepared graph against the current PBF, loads
the canonical locality CSV, and snaps all localities to the graph in memory.
Those locality anchors are fingerprinted for provenance but are not persisted.
OSRM Table requests fill the matrix in bounded 50 × 50 blocks. Durations are
rounded conservatively with `ceil(seconds / 60)` and written directly in the
final row-major UInt8 format: `0–240` are minutes and `255` means unreachable or
beyond four hours. Self cells are always zero.

Completed origin blocks are checkpointed in
`data/processed/road/matrix-build/`; a compatible interrupted run resumes
automatically. After deterministic Route-service sample validation, the final
pair is authenticated and published directly to:

```text
data/runtime/car/
  manifest.json
  travel-times.bin
```

There is no persisted locality-anchor artifact, full UInt16 matrix, conversion
pass, or separate runtime-data build. Publication promotes the matrix first and
the manifest last, then removes the resumable work directory after authenticated
readback. The manifest retains only locality-input, in-memory anchor, and road
graph provenance in addition to the shared matrix descriptor.

Verify the published data without Docker or OSRM with:

```bash
npm run road:verify
```

The transport-independent `packages/commute/src/travel-time-matrix` runtime
consumes the shared descriptor and dense `UInt8` bytes, builds the locality-ID
index once, and supports directional point lookup and a one-row reachability
scan. The package car API is a thin mode-specific façade over that
implementation. Point
lookup returns whole minutes or `undefined` for an unavailable pair.
Reachability returns the shared `{ localityId, travelMinutes }` shape, ordered
by travel time and then locality ID.

OSRM is not required for runtime car reachability. Each runtime reachability
query scans exactly one precomputed locality matrix row.

The canonical runtime format is row-major `UInt8`: `0–240` are whole travel
minutes, `255` means unavailable or beyond the published four-hour horizon,
and `241–254` are reserved and invalid in schema version 1. The four-hour
dataset capability is separate from product policy. An application may expose
a smaller maximum without changing or regenerating the matrix; the validation
viewer deliberately exposes the full 15–240-minute range.

Because each cell is one byte, the common runtime path uses a zero-copy
`Uint8Array` view over approximately 15.82 MiB rather than retaining a second
decoded matrix. The locality-ID index is built once.

The `data/runtime/car` directory is the publication source for the two car
assets copied into `packages/commute/data/car`. The installed Node loader reads
only its own package-relative catalog and mode assets. It does not read the
matrix work directory, locality CSV, OSRM graph, or OpenStreetMap PBF.

This first graph intentionally contains Switzerland only. Near-border routes
can therefore be disconnected or suboptimal when the real road route briefly
enters Germany, France, Italy, Austria, or Liechtenstein. No neighboring extract
is downloaded or merged in this milestone; expanding the data scope remains a
separate future decision.

OpenStreetMap data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
and is available under the Open Database License. The Switzerland extract is
distributed by [Geofabrik](https://download.geofabrik.de/europe/switzerland.html).

### Public-transport data

Static Swiss public-transport data comes from the GTFS timetable published by
opentransportdata.swiss. The compiler is organized as one explicit flow:

```text
raw GTFS + official localities
  → src/public_transport/prepare
  → src/public_transport/network
  → src/public_transport/matrix
  → data/runtime/transit/{manifest.json,travel-times.bin}
```

The three stages expose `prepareData`/`loadPreparedData`, `buildNetwork`, and
`calculateTravelTimes` through `src/public_transport/index.ts`. They are
offline-only and are never imported by `@jm/commute` at runtime.

### Central configuration

OSRM identity, request sizing, retry policy, the reference service date,
representative morning window, locality access, and routing limits are
configured in `src/config.ts`.

### Representative morning commute

Commute estimates use Monday, 7 September 2026 as a fixed representative day
and search for the fastest journey whose origin departure falls within
07:00–09:00.

Travel time is measured from the selected origin departure to destination arrival, including initial access transfers and waiting time.

The morning window is intended to represent a normal commuting period rather than an exact requested departure.

All scheduled public-transport route types are retained. Locality access is
derived directly from normalized stops: every transit place within 700 metres
is used, otherwise the ten nearest places are used.

### Fixed-day routing data

Routing data is prepared for the configured representative Monday. Scheduled trips that can still be boarded at or after the 07:00 morning-window start are retained with their complete stop sequence. The 09:00 boundary limits only origin departures; later connecting services remain in the timetable.

GTFS frequency windows are preserved in the fixed-day input and expanded only when the compact timetable is built.

The routing manifest records a SHA-256 digest of the NDJSON trip stream. All consumers use one canonical streamed loader that validates the schema, normalized trip records, manifest counts, digest, and configured scenario before building the timetable.

Preparation writes only the normalized stops and fixed-day routing stream:

```text
data/processed/public_transport/
  stops.json
  fixed-day-routing/
    manifest.json
    trips.ndjson
```

Run preparation with:

```bash
npm run public-transport:prepare
```

If the complete prepared dataset already exists, the command exits successfully
without rereading GTFS. Use `npm run public-transport:prepare -- --restart` for
an intentional rebuild. Before writing anything, preparation checks its required
raw GTFS files and lists any missing inputs.

Transit places and locality-to-source-stop memberships are derived in memory
when prepared data is loaded. Dense locality stop indexes are resolved only
after the exact network has assigned its deterministic stop indexes, so there
is no additional persisted preprocessing artifact.

### Canonical transit commute matrix

RAPTOR is a build-time compiler for the production transit dataset. Generate
the complete representative-morning matrix in canonical locality order with:

```bash
npm run public-transport:matrix
```

The command validates the prepared data against the configured scenario and raw
GTFS feed, derives locality source-stop memberships, builds the complete typed
network once, and calculates the 4,073 × 4,073 matrix. It checkpoints every ten
complete origin rows in `data/processed/public_transport/matrix-build/`. A
compatible interrupted build resumes automatically. If the published matrix
already exists, the command exits successfully before loading prepared data or
building the network. Use `npm run public-transport:matrix -- --restart` for an
intentional rebuild. If prepared inputs are absent or incomplete, the command
stops before loading or network construction and points to
`npm run public-transport:prepare`.

After deterministic sample validation, the command authenticates and publishes
the final pair directly to `data/runtime/transit/`. The matrix is promoted
before the manifest, so an interrupted publication fails closed. The work
directory is removed only after successful authenticated readback.

Verify the published assets without loading GTFS or RAPTOR with:

```bash
npm run public-transport:verify
```

These commands print stage transitions, elapsed time, and periodic progress so
long-running work remains visible in non-interactive terminals. Expected file
errors are reported as concise messages with a recovery command instead of a
stack trace.

The generated value for each origin/destination pair is the shortest total
journey duration among journeys whose origin departure occurs within
07:00–09:00. The window restricts departure, not arrival. Values through 240
minutes are retained, so a journey departing at 08:55 may arrive well after
09:00. `255` means unavailable within four hours.

```text
data/runtime/transit/
  manifest.json
  travel-times.bin
```

Those two files are the publication source for production transit lookup.
`@jm/commute/node` authenticates their package copies; the transit façade
delegates to the same shared `TravelTimeIndex` used by car. Neither RAPTOR, a
timetable, transfers, GTFS, nor locality stop mappings are loaded at production
runtime.

The transit manifest wraps the shared matrix descriptor with the service date,
morning departure window, GTFS feed version, prepared-trip digest, an exact
fingerprint of the constructed timetable/transfer state, the in-memory locality
mapping fingerprint, and effective routing policy. Both fingerprints describe
the exact in-memory compiler inputs; neither requires another persisted
intermediate. The manifest contains no timestamps or machine paths.

### Compact RAPTOR timetable

The fixed-day trips are streamed into deterministic dense stop IDs and compact, non-overtaking route patterns. Stop times use typed arrays, pickup and drop-off values use two-bit packing, and each stop has route-pattern adjacency for later RAPTOR scans.

Frequency templates are expanded at their declared headways during timetable construction. Both `exact_times=0` and `exact_times=1` use the same deterministic expansion; treating non-exact headways as exact instances is an intentional commute-estimation approximation.

### RAPTOR reachability

The router performs multi-source, one-to-all Range-RAPTOR queries against the compact fixed-day timetable.

Meaningful direct and access-adjusted departure opportunities are evaluated latest-to-earliest within 07:00–09:00. The result stores the shortest travel duration to every reachable stop together with its best departure and corresponding arrival, bounded by the requested maximum commute duration.

The transit matrix publishes the fastest representative-morning journey whose
origin departure occurs within 07:00–09:00, preserving durations up to 240
minutes. The window restricts departure, not arrival: for example, a
journey departing at 08:55 and arriving after 09:00 remains eligible when its
total duration is no more than four hours. The commute viewer exposes the
complete 15–240-minute range so both compiled datasets can be compared across
their full four-hour horizon.

Transfers can connect different dense routing-stop IDs without consuming another vehicle leg. Only one transfer edge is traversed after a vehicle arrival; transfer edges are not chained within a RAPTOR round.

### Transfers

Routing uses supported generic GTFS transfer rules and fills missing
connections between active sibling platforms belonging to the same parent
station. Trip-specific guaranteed transfers, route-specific restrictions, and
in-seat continuations are not modeled.

### Initial station access

Before the first RAPTOR vehicle is boarded, the router may follow one access-eligible transfer from each selected origin stop.

This allows a nearby surface stop or platform to reach another platform inside the same interchange before the first vehicle.

Initial access currently uses one transfer edge only; it does not chain walking transfers.

### Reachable localities

Every Swiss ZIP-and-city pair has a deterministic, transport-independent
locality ID derived from its postal code and normalized city name. During the
network build, prepared source-stop memberships are resolved to the network's
dense stop indexes entirely in memory.

One Range-RAPTOR result is reduced to the shortest duration across each
locality's routing stops and rounded upward to whole travel minutes. Both
offline compilers publish the same product-facing locality ID and travel-minute
shape without exposing OSRM, GTFS, or RAPTOR identifiers.

The intended job boundary is a transport-independent value such as `job.locality_id = "8001:zurich"`. A future matching layer can run routing once when a user's location or commute preference changes, cache the reachable locality IDs, and use an indexed relational join or `job.locality_id IN (...)`. No database integration is implemented yet.

### Commute viewer

The Vue/Vite validation viewer under `apps/commute-viewer` is a presentation-
only client of `apps/commute-api`. Start the API and viewer separately:

```bash
npm run commute:api:dev
npm run viewer:dev
```

Create a production Vite build with:

```bash
npm run viewer:build
```

The viewer fetches all 4,073 canonical localities once. Selecting an origin or
switching between car and public transport requests one complete 240-minute
GeoJSON overlay; moving the 15–240-minute slider only changes MapLibre layer
filters. Origin changes recenter at city scale, while mode and slider changes
preserve the camera. The browser contains no RAPTOR, timetable, matrix, Base64,
stop-level, or hex-construction runtime. OpenFreeMap basemap tiles still require
network connectivity, and the viewer is served through Vite rather than opened
with `file://`.
