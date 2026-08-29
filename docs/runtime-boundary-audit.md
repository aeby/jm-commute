# Runtime and offline-compiler boundary

This note records the implemented ownership boundary between the offline route
compilers and the production `@jm/commute` package.

## Canonical direction

```text
raw transport data
       ↓
offline compilers in root src/
       ↓
authenticated locality matrices
       ↓
@jm/commute/node
       ↓
CommuteRuntime
```

Routing engines never cross into the production package. They compile
transport-specific source data into the same transport-independent,
locality-ordered matrix contract.

## Public-transport compiler

The public-transport compiler lives under one source root:

```text
src/public_transport/
  prepare/   # raw GTFS normalization and validated prepared-data loading
  network/   # exact dense timetable, transfers, and locality stop mapping
  matrix/    # RAPTOR queries, resumable matrix generation, and publication
```

Its public flow is intentionally small:

```text
prepareData / loadPreparedData
             ↓
         buildNetwork
             ↓
     calculateTravelTimes
```

`src/public_transport/index.ts` exposes those stage-level functions. Detailed
GTFS, timetable, transfer, and RAPTOR modules remain internal to their owning
stage.

### Prepare

`npm run public-transport:prepare` reads the configured raw GTFS feed and
writes only:

```text
data/processed/transit/
  stops.json
  fixed-day-routing/
    manifest.json
    trips.ndjson
```

The manifest binds the trip stream to the selected feed, service date, and
routing window. Loading prepared data revalidates that provenance against the
current raw feed. Transit places and locality source-stop memberships are
derived in memory from normalized stops and the official locality CSV.

### Network

`buildNetwork` consumes only explicit prepared inputs. It:

- expands declared GTFS frequency windows, retaining instances boardable at or
  after the routing-window start;
- assigns deterministic dense indexes to opaque source stop IDs;
- builds compact, non-overtaking route patterns and stop adjacency;
- applies supported generic GTFS transfer rules and sibling-platform links;
- resolves locality source-stop memberships into the same dense stop space.

The result is one in-memory `PublicTransportNetwork` plus its locality mapping.
Neither is persisted as an intermediate artifact.

### Matrix

`npm run public-transport:matrix` builds the network once and runs
representative-morning Range-RAPTOR queries for all 4,073 origins. The result is
a 4,073 × 4,073 row-major `UInt8` matrix. Values `0` through `240` are travel
minutes and `255` means unavailable within four hours.

Generation checkpoints every ten complete origin rows under
`data/processed/transit/matrix-build/`. A compatible interrupted run resumes;
`npm run public-transport:matrix -- --restart` intentionally replaces that
workspace.

After deterministic validation, publication writes and authenticates:

```text
data/runtime/transit/
  manifest.json
  travel-times.bin
```

The manifest records the source scenario and exact fingerprints of the trip
stream, built network, and in-memory locality mapping. Publication promotes the
matrix before the manifest and removes the resumable workspace only after
authenticated readback.

`npm run public-transport:verify` validates the published pair and fixed
reference results using runtime assets only.

## Runtime package

`packages/commute` remains the sole production owner. Its public vocabulary is
unchanged: consumers use `commute.transit`, `TransitTravelTimeIndex`, and the
high-level transit reachability methods. Package data remains under:

```text
packages/commute/data/transit/
  manifest.json
  travel-times.bin
```

`@jm/commute/node` resolves package-relative locality, car, and transit assets;
authenticates their manifests and bytes; requires identical locality ordering;
and returns one `CommuteRuntime`.

The package contains no GTFS readers, RAPTOR state, timetable, transfer graph,
raw locality CSV, OSRM graph, OSM data, or matrix-generation code. Compiler
typed arrays are mutable internally but cannot be reached through package
exports.

## Other owners

- `src/localities/node.ts` parses the official locality CSV for offline jobs.
- `src/car/preprocessing/` and `scripts/car/` own the OSRM-based car compiler.
- `apps/commute-api` joins package reachability results to representative
  coordinates and serves GeoJSON.
- `apps/commute-viewer` is a presentation-only client of that API.

There is no browser routing package. The viewer never imports raw matrix bytes,
RAPTOR, GTFS, OSRM, or root compiler modules.

## Enforced dependency rules

- Root compilers may consume public `@jm/commute` contracts and the root-only
  `@commute-internal/*` alias.
- Package runtime code must not import root compiler modules or raw datasets.
- Browser code accesses commute results through the HTTP API.
- Runtime publication formats are shared only at the locality-matrix boundary;
  public-transport and road-network internals do not share speculative
  abstractions.
