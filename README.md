# Swiss Commute Reachability

A TypeScript project with an offline routing core for estimating which jobs are reachable by public transport in Switzerland.

Users and jobs are identified approximately by postcode and/or city name. The system will map these locations to public-transport stops and use Swiss timetable data to calculate realistic travel times around lakes, mountains, valleys, and other geographic obstacles.

## Planned pipeline

1. Resolve postcode and city names to official locality coordinates.
2. Map each locality to nearby public-transport stops.
3. Load Swiss GTFS timetable data.
4. Calculate reachable stops with RAPTOR.
5. Match reachable localities to jobs.
6. Visualize stop-level reachability on an interactive commute map.

## Current milestone

The current implementation prepares a compact fixed-day timetable, runs multi-source one-to-all public-transport queries, reduces reachable stops to transport-independent Swiss localities, and visualizes the result in a Vue/MapLibre commute viewer.

GTFS station records and their child platforms are normalized into logical transit places, while standalone stops remain individual transit places.

Journey reconstruction, transfer chaining, and job matching remain out of scope.

## Module boundaries

- `src/localities/` owns transport-independent locality identity, parsing, resolution, and reachable-locality result types.
- `src/transit/gtfs/` owns reusable GTFS date, time, calendar, CSV, and fixed-date feed foundations.
- `src/transit/stops/`, `places/`, `service-profiles/`, and `candidates/` normalize and select logical transit access points.
- `src/transit/routing-data/` prepares and validates the streamed fixed-day routing dataset.
- `src/transit/raptor/` owns compact timetable construction, transfer connectivity, and routing.
- `src/transit/locality-routing/` is the public-transport adapter between generic localities and RAPTOR stop indexes/results.
- `src/car/` owns the platform-neutral, pure-TypeScript car matrix format and lookup runtime (and is therefore browser-safe); its optional Node loader is isolated in `src/car/node.ts`, while Docker, OSRM HTTP, and preprocessing filesystem code stay under `src/car/preprocessing/` and `scripts/car/`.
- `apps/commute-viewer/` contains the Vue/Vite development viewer; it imports browser-safe routing modules from `src/` rather than duplicating them.

## Development

```bash
npm install
npm test
npm run typecheck
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
npm run car:runtime:inspect
npm run viewer:dev
```

The downloaded source data is stored under `data/raw/` and is not committed to Git. Unit tests use a small local fixture and require no network access.

## Data source

Locality data comes from the official directory of towns and cities published by the Federal Office of Topography swisstopo.

Source attribution: **©swisstopo**

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
Offline preprocessing

official locality
    ↓
nearest routable road point
    ↓
persisted locality road anchor
    ↓
OSRM Table preprocessing
    ↓
directional locality × locality travel-time matrix
    ↓
data/processed/car/travel-time-matrix/

Runtime-data packaging

validated processed manifest + binary
    ↓
data/runtime/car/manifest.json + travel-times.bin

Runtime lookup

the two packaged runtime files
    ↓
platform-neutral TypeScript car reachability index
    ↓
point travel time or reachable-locality results
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

Package the validated matrix into the deliberately smaller runtime-data
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
runtime manifest and binary remain cryptographically tied by the matrix SHA-256
and declared byte length. Verify the packaged pair independently with:

```bash
npm run car:runtime:verify
```

Building or verifying this runtime pair needs neither Docker nor a live OSRM
service. Packaging consumes the already prepared matrix; verification reads
only the packaged pair. Neither command regenerates road anchors or any
public-transport data.

The platform-neutral `src/car` runtime consumes the validated manifest and
matrix bytes, builds the locality-ID index once, and supports both a
directional point lookup and a one-to-many reachability scan. Point lookup
returns whole minutes or `undefined` for an unreachable pair. Reachability
returns the same transport-independent `{ localityId, travelMinutes }` shape
used by public transport, ordered by travel time and then locality ID.

OSRM is not required for runtime car reachability. Each runtime reachability
query scans exactly one precomputed locality matrix row.

The runtime keeps the generated format unchanged: row-major `UInt16`
little-endian whole minutes, with `65535` reserved for unreachable cells. On a
little-endian host it can read the matrix through a typed view without copying
the 33 MB payload; the runtime diagnostics report whether a copy was required.
The `data/runtime/car` directory is the complete generated data dependency: its
`manifest.json` and `travel-times.bin` are the only generated files the runtime
loads. It does not read the processed matrix path, road anchors, locality CSV,
OSRM graph, or OpenStreetMap PBF. A Node-only loader is available under
`src/car/node`, while the public `src/car` boundary contains no filesystem,
Docker, OSRM, PBF, HTTP-service, or preprocessing dependency.

Benchmark the real runtime implementation with deterministic initialization,
point-lookup, and Zürich 90-minute reachability samples using:

```bash
npm run car:runtime:inspect
```

This inspection command is performance- and behavior-oriented: it prints
reference lookups and reachable-locality counts, then reports matrix-copy,
memory, and timing distributions. Use `car:runtime:verify` for the focused
runtime-artifact integrity check. Neither command requires OSRM.

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

### Compact RAPTOR timetable

The fixed-day trips are streamed into deterministic dense stop IDs and compact, non-overtaking route patterns. Stop times use typed arrays, pickup and drop-off values use two-bit packing, and each stop has route-pattern adjacency for later RAPTOR scans.

Frequency templates are expanded at their declared headways during timetable construction. Both `exact_times=0` and `exact_times=1` use the same deterministic expansion; treating non-exact headways as exact instances is an intentional commute-estimation approximation.

### RAPTOR reachability

The router performs multi-source, one-to-all Range-RAPTOR queries against the compact fixed-day timetable.

Meaningful direct and access-adjusted departure opportunities are evaluated latest-to-earliest within 07:00–09:00. The result stores the shortest travel duration to every reachable stop together with its best departure and corresponding arrival, bounded by the requested maximum commute duration.

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

A Vue/Vite map viewer is available under `apps/commute-viewer`.

Prepare its local runtime data and start the development server with:

```bash
npm run viewer:dev
```

Create a production Vite build with:

```bash
npm run viewer:build
```

The viewer uses the same fastest-window public-transport routing implementation, compact timetable, transfer graph, and locality routing index as the core project. It visualizes reachable transit-stop positions as deterministic approximately one-kilometre hexagons above an OpenFreeMap/OpenStreetMap basemap.

Changing the origin recalculates routing once at the viewer's 120-minute maximum. Changing only the commute-time slider filters that existing result without rerunning RAPTOR.

Routing data stays local and no routing API is used. The OpenFreeMap basemap tiles require network connectivity, and the viewer is served through Vite rather than opened with `file://`.
