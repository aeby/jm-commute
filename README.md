# Swiss Commute Reachability

A TypeScript project with offline car and public-transport routing compilers and
a compact runtime for estimating which Swiss localities are mutually reachable.

Users and jobs are identified approximately by postcode and/or city name. The system will map these locations to public-transport stops and use Swiss timetable data to calculate realistic travel times around lakes, mountains, valleys, and other geographic obstacles.

## Planned pipeline

1. Resolve postcode and city names to official locality coordinates.
2. Map each locality to nearby public-transport stops.
3. Load Swiss GTFS timetable data.
4. Compile representative-morning transit reachability with RAPTOR.
5. Match reachable localities to jobs.
6. Serve locality-based reachability GeoJSON to an interactive commute map.

## Current milestone

The current implementation compiles car and representative-morning transit
journeys into deterministic dense locality-to-locality matrices. The
`@jm/commute` workspace package ships those matrices together with the 4,073
official locality records and answers production queries without either
routing engine. A small Node API joins reachable locality IDs to representative
coordinates and serves deterministic GeoJSON to the Vue/MapLibre viewer. The
browser performs presentation and local threshold filtering only.

GTFS station records and their child platforms are normalized into logical transit places, while standalone stops remain individual transit places.

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
- **Preprocessing:** GTFS ingestion, candidates, service profiles, normalized
  routing NDJSON, RAPTOR timetable/transfer construction and matrix compilation,
  plus OSRM, anchors, car publication, and diagnostics remain build-time
  concerns.
- **HTTP visualization adapter:** `apps/commute-api` loads the package once and
  owns locality JSON, strict request validation, coordinate joining, hex-grid
  aggregation, GeoJSON, caching headers, and development CORS.
- **Browser/viewer:** `apps/commute-viewer` fetches the locality catalog and one
  complete 240-minute GeoJSON overlay per origin/mode selection. It owns only
  autocomplete, MapLibre presentation, and local duration filtering.

Platform-neutral runtime code is shared where natural, but browser
compatibility is not a constraint on the canonical Node loader or
preprocessing. The history- and import-backed classifications are recorded in
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
npm run data:prepare:stops
npm run data:prepare:places
npm run data:prepare:service-profiles
npm run data:prepare:routing-trips
npm run data:prepare:locality-routing-index
npm run car:osrm:prepare
npm run car:anchors:prepare
npm run car:matrix:prepare
npm run car:matrix:inspect
npm run car:runtime:data
npm run car:runtime:verify
npm run transit:matrix:prepare
npm run transit:matrix:inspect
npm run transit:runtime:verify
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

### Offline car-routing preprocessing

OpenStreetMap provides the source road network. OSRM is used only during
offline preprocessing with its standard `car.lua` profile and Contraction
Hierarchies. The production/runtime representation is a compact, precomputed
locality-to-locality driving-time dataset; the TypeScript
lookup library will require neither OSRM, Docker, the OpenStreetMap PBF, nor an
HTTP routing service.

Manually place the Geofabrik Switzerland extract at:

```text
data/raw/osm/switzerland-latest.osm.pbf
```

The preparation script does not download the extract. It keeps that source
mount read-only, pins the official
`ghcr.io/project-osrm/osrm-backend:26.8.0-debian` image, runs the standard car
extraction and CH contraction pipeline, and writes the deterministic dataset
base `data/processed/car/osrm/switzerland.osrm`:

```bash
npm run car:osrm:prepare
```

The preparation output omits the `.cnbg` and `.cnbg_to_ebg` extraction
intermediates because the pinned CH routing service does not consume them.

Start the development/preprocessing service on the loopback interface only:

```bash
docker run --rm \
  --publish 127.0.0.1:5000:5000 \
  --mount type=bind,source="$PWD/data/processed/car/osrm",target=/data,readonly \
  ghcr.io/project-osrm/osrm-backend:26.8.0-debian \
  osrm-routed --algorithm ch /data/switzerland.osrm
```

Inspect one locality-to-locality route while that service is running:

```bash
npm run car:inspect -- \
  --from-postal-code 8001 \
  --from-city Zürich \
  --to-postal-code 3011 \
  --to-city Bern
```

Run the reproducible snap and route diagnostic suite with:

```bash
npm run car:inspect -- --diagnostics
```

The car architecture keeps offline preparation, runtime-data packaging, and
runtime lookup as explicit boundaries:

```text
PREPROCESSING

Car
OSM → OSRM → full UInt16 locality matrix
                         ↓
                UInt8 publication
                  0–240 / 255

Transit
data/processed/transit inputs → RAPTOR compiler
                                      ↓
                            UInt8 locality matrix
                                0–240 / 255
                                      ↓
                          data/runtime/transit/

PACKAGE DATA / RUNTIME

localities.json   car matrix   transit matrix
       └──────────────┬──────────────┘
                      ↓
             @jm/commute/node
                      ↓
       LocalityCatalog + TravelTimeIndex
                      ↓
                CommuteRuntime
```

With the local OSRM service running, generate the strictly validated anchor
artifact at `data/processed/car/locality-road-anchors.json`:

```bash
npm run car:anchors:prepare
```

Inspect the persisted distribution, ten longest snaps, and reference
localities without running OSRM (the current official locality CSV supplies
display names, original coordinates, and staleness validation):

```bash
npm run car:anchors:inspect
```

Large snap distances are retained rather than excluded. For now the nearest
routable point is intentionally the complete car-anchor approximation, and the
stored snap distance makes mountain and other unusual cases visible for later
policy decisions. These anchors are preprocessing data, not a public runtime
API. Anchors are stored in locale-independent lexical `localityId` order. Their
input fingerprint is the SHA-256 of compact JSON containing exactly
`localityId`, `latitude`, and `longitude` in that same order, with no timestamp.

With the local OSRM service running, generate the complete directional matrix
from those persisted anchors:

```bash
npm run car:matrix:prepare
```

Matrix generation is resumable by completed source-row blocks and uses OSRM's
Table service only during offline preprocessing. The resulting
`data/processed/car/travel-time-matrix/travel-times.bin` is deterministic
row-major `UInt16` data encoded explicitly in little-endian byte order. Rows
and columns share the exact ordered locality IDs recorded in `manifest.json`.
Each value is a whole travel time in minutes, conservatively calculated as
`ceil(durationSeconds / 60)`; `65535` is reserved for an unreachable
origin/destination pair. Self-cells are always zero.

Inspect the completed matrix, reachability, connectivity, and directional
diagnostics without Docker or a running OSRM service:

```bash
npm run car:matrix:inspect
```

### Car runtime data

`data/processed/car/` is the offline working area. It contains preprocessing
inputs and intermediates such as the OSRM graph, locality road anchors, and the
validated matrix output. None of those paths is a production/runtime contract.

Package the validated full matrix into the deliberately smaller runtime-data
boundary with:

```bash
npm run car:runtime:data
```

The command writes exactly two deployable data files:

```text
data/runtime/car/
  manifest.json
  travel-times.bin
```

Both are generated and Git-ignored; the directory's `.gitkeep` is tracked. The
publisher authenticates the full `UInt16` preprocessing matrix, converts each
cell deterministically, and leaves that source unchanged:

```text
source 0–240   → same UInt8 minute value
source > 240   → 255
source 65535   → 255
```

The runtime manifest wraps the transport-independent matrix descriptor with
car-specific source-matrix, anchor, locality-input, and road-graph provenance.
The manifest and binary remain cryptographically tied by the runtime matrix
SHA-256 and declared byte length. Publication authenticates both staged files,
promotes the matrix first, and promotes the manifest last as the commit marker;
an interrupted fixed-name promotion therefore fails closed during the next
authenticated load. Verify the packaged pair independently with:

```bash
npm run car:runtime:verify
```

Building or verifying this runtime pair needs neither Docker nor a live OSRM
service. Packaging consumes the already prepared matrix; verification reads
only the packaged pair. Neither command regenerates road anchors or any
public-transport data.

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
processed matrix path, road anchors, locality CSV, OSRM graph, or OpenStreetMap
PBF.

This first graph intentionally contains Switzerland only. Near-border routes
can therefore be disconnected or suboptimal when the real road route briefly
enters Germany, France, Italy, Austria, or Liechtenstein. No neighboring extract
is downloaded or merged in this milestone; those diagnostics will inform a
later data-scope decision.

OpenStreetMap data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
and is available under the Open Database License. The Switzerland extract is
distributed by [Geofabrik](https://download.geofabrik.de/europe/switzerland.html).

### Public-transport data

Static Swiss public-transport data comes from the GTFS timetable published by opentransportdata.swiss.

Timetable files are used to build morning transit-place service profiles, fixed-day routing input, and an in-memory RAPTOR timetable.

### Central configuration

The reference service date, representative morning window, local-access radius, fallback candidate count, routing limits, and transfer-generation settings are configured in `src/config.ts`.

### Representative morning commute

Commute estimates use a fixed representative Monday and search for the fastest journey whose origin departure falls within 07:00–09:00:

- Monday, 7 September 2026
- transit-place activity measured from 07:00 until 09:00

Travel time is measured from the selected origin departure to destination arrival, including initial access transfers and waiting time.

The morning window is intended to represent a normal commuting period rather than an exact requested departure.

Local access candidates normally include every transit place within 700 metres of the locality coordinate. When none exists, the ten geographically nearest places are returned as fallback candidates.

Candidate ranking uses all-mode route diversity and service frequency. Railway connectivity is additional metadata and does not exclude or suppress buses, trams, ferries, cableways, or other scheduled public transport.

### Fixed-day routing data

Routing data is prepared for the configured representative Monday. Scheduled trips that can still be boarded at or after the 07:00 morning-window start are retained with their complete stop sequence. The 09:00 boundary limits only origin departures; later connecting services remain in the timetable.

GTFS frequency windows are preserved in the fixed-day input and expanded only when the compact timetable is built.

The routing manifest records a SHA-256 digest of the NDJSON trip stream. All consumers use one canonical streamed loader that validates the schema, normalized trip records, manifest counts, digest, and configured scenario before building the timetable.

Prepared transit inputs share one namespace:

```text
data/processed/transit/
  stops.json
  places.json
  place-service-profiles.json
  fixed-day-routing/
    manifest.json
    trips.ndjson
  locality-routing-index.json
  matrix-build/              # resumable partial matrix and checkpoint only
```

### Canonical transit commute matrix

RAPTOR is a build-time compiler for the production transit dataset. Generate
the complete representative-morning matrix in canonical locality order with:

```bash
npm run transit:matrix:prepare
```

The command builds the trusted timetable and transfer graph once, binds them to
a preprocessing-only locality query, and compiles all 4,073 origin rows. It
checkpoints every ten complete rows in `data/processed/transit/matrix-build/`;
`--restart` replaces only that resumable workspace. After validating the
completed matrix, the same command authenticates and promotes the final pair to
`data/runtime/transit/`. Promotion writes the matrix first and the manifest
last, so interruption fails closed under the authenticated loader; the compiler
workspace is removed only after successful readback. Inspect the result without RAPTOR with:

```bash
npm run transit:matrix:inspect
```

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

There is no second processed copy or byte-copy publication command. Verify the
final pair independently using only runtime assets with:

```bash
npm run transit:runtime:verify
```

Those two files are the publication source for production transit lookup.
`@jm/commute/node` authenticates their package copies; the transit façade
delegates to the same shared `TravelTimeIndex` used by car. Neither RAPTOR, a
timetable, transfers, GTFS, nor the locality-routing index is loaded at
production runtime.

The transit manifest wraps the shared matrix descriptor with the service date,
morning departure window, GTFS feed version, prepared-trip digest, an exact
fingerprint of the constructed timetable/transfer state, the locality-routing
artifact SHA-256, and the effective routing policy. It contains no timestamps
or machine paths.

The current repository has no separately persisted prepared transfer graph.
Consequently, matrix preparation reconstructs that in-memory graph once using
the already-present local GTFS calendar and transfer inputs. It does not
download or regenerate raw GTFS. Persisting that intermediate graph would be a
future preprocessing improvement; it does not affect the final runtime
boundary.

The existing locality-routing artifact also predates explicit upstream
provenance: it stores deterministic numeric stop indexes but no embedded
timetable/source-stop fingerprint or candidate-policy fields. This build
records the exact artifact SHA-256 alongside the exact constructed-timetable
fingerprint and treats that prepared pair as trusted. A future locality-index
schema should cryptographically bind those two inputs before they reach matrix
generation.

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
total duration is no more than four hours. The validation viewer exposes the
complete 15–240-minute range so both compiled datasets can be inspected across
their full four-hour horizon.

Transfers can connect different dense routing-stop IDs without consuming another vehicle leg. Only one transfer edge is traversed after a vehicle arrival; transfer edges are not chained within a RAPTOR round.

### Transfers

Routing uses explicit GTFS transfer rules and automatically fills missing connections between active sibling platforms belonging to the same parent station.

An optional straight-line transfer generator can connect nearby stops using a configurable walking heuristic. It is disabled by default.

Default virtual-transfer parameters are:

- maximum distance: 500 m
- walking speed: 4 km/h
- detour factor: 1.3
- change penalty: 3 minutes

Virtual transfers are deliberately treated as an approximation rather than authoritative timetable data.

Trip-specific guaranteed transfers, route-specific transfer restrictions, and in-seat continuations are classified during preparation but are not yet modeled by the router.

### Initial station access

Before the first RAPTOR vehicle is boarded, the router may follow one access-eligible transfer from each selected origin stop.

This allows a nearby surface stop or platform to reach another platform inside the same interchange before the first vehicle.

Initial access currently uses one transfer edge only; it does not chain walking transfers.

### Reachable localities

Every Swiss ZIP-and-city pair has a deterministic, transport-independent locality ID derived from its postal code and normalized city name. The offline public-transport locality routing index maps each locality to all active RAPTOR stops contributed by the existing local-access candidate policy.

One Range-RAPTOR result is reduced to the shortest duration across each locality's routing stops and rounded upward to whole travel minutes. The product-facing result contains only a locality ID and travel minutes, so a future road router can produce the same shape without exposing GTFS or RAPTOR identifiers.

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
