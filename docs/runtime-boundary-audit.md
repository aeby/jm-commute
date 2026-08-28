# Runtime boundary audit

This report records the ownership decisions and resulting runtime boundary.
Decisions are based on import consumers and Git history, not directory names
alone.

Milestone 6C completed the extraction described by this audit. Canonical
runtime ownership is now `packages/commute/src`; root `src/` retains only raw
locality ingestion and car/transit compiler code. References below to former
root runtime paths document the ownership decision that led to the move rather
than compatibility entry points—none were left behind.

The canonical direction is server-first:

```text
locality catalog + matrix runtime <- Node/server integration
                 ^
                 |
          offline preprocessing
```

Platform-neutral algorithms and typed arrays stay shared where that is natural.
Browser compatibility is not a constraint on Node loaders or preprocessing.
No browser package is currently planned; the browser viewer calls the small
server that uses `@jm/commute`.

## Extracted package boundary

`@jm/commute` exposes only `.` and `./node`. It ships the authenticated official
locality catalog plus separate raw UInt8 car and transit matrices. The Node
entry resolves those assets relative to `import.meta.url`, authenticates them,
requires catalog/car/transit locality ordering to match, and returns one
`CommuteRuntime`. No GTFS, RAPTOR, OSRM, OSM, matrix generation, viewer schema,
or raw swisstopo CSV is present in the package.

Root preprocessing consumes package contracts through the public workspace
entry or a root-only `@commute-internal/*` source alias. That alias is absent
from npm exports and clean installed consumers receive
`ERR_PACKAGE_PATH_NOT_EXPORTED` for package internals.

## KEEP_IN_RUNTIME_CORE

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `packages/commute/src/localities/` | Defines transport-independent locality identity, normalization, catalog lookup, and `ReachableLocality` semantics | Public package domain |
| `src/transit/raptor/routing/` | Implements Range-RAPTOR and transfer relaxation without platform APIs | Internal transit matrix compiler |
| RAPTOR timetable layouts and route-pattern access | Compact typed-array state consumed while compiling the matrix | Transit preprocessing; never consumer-facing mutable data |
| Transfer adjacency semantics and `USE_QUERY_TRANSFER_TIME` | Required while compiling transit rows | Transit preprocessing |
| Transit locality result reduction | Maps stop-space results to transport-independent locality results | Internal compiler bridge reused by matrix generation |
| Pure GTFS date/time and pickup/drop-off primitives | Shared semantic primitives without file I/O | Runtime-neutral transit support |
| `packages/commute/src/travel-time-matrix/` | Opaque directional matrix lookup, strict descriptor, and one-row reachability scan | Transport-independent shared package runtime |
| `packages/commute/src/car/travel-time-index.ts` | Thin car manifest/provenance façade over the shared matrix | Public car runtime implementation |
| `packages/commute/src/transit/travel-time-index.ts` | Thin transit manifest/provenance façade over the shared matrix | Public transit runtime implementation |

The transit compiler may retain mutable typed arrays internally. They are
hidden through entry-point ownership and are not part of production data.

## MOVE_TO_NODE_ENTRYPOINT

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `packages/commute/src/node.ts` and `internal/load-travel-time-data.ts` | Package-relative catalog/matrix loading and SHA-256 authentication | Canonical aggregate Node entry point; only `./node` is exported |
| `src/localities/node.ts` | Raw official-locality CSV ingestion | Node/preprocessing entry point, not domain runtime |
| `src/transit/gtfs/node.ts` | Filesystem/streaming GTFS CSV ingestion | Node-only preprocessing |
| `src/transit/locality-routing/node.ts` | Generated locality-index file loading | Node-only loading; not a consumer root export |
| `src/transit/routing-data/node.ts` | Processed manifest and NDJSON loading | Node-only preprocessing |
| `src/transit/raptor/transfers/node.ts` | Streaming raw `transfers.txt` | Node-only preprocessing |

The root Node splits were introduced while making the former validation UI
bundle, but they express a sound preprocessing boundary and are retained. The
package Node loader reads only its catalog and two published dense matrices. It
does not promote `scripts/transit/load-raptor-compiler.ts`, which rebuilds
compiler state from processed NDJSON and raw GTFS, into production.

## MOVE_TO_PREPROCESSING

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `src/transit/routing-data/` | Normalized trips, manifest, NDJSON preparation and validation | Transit preprocessing |
| RAPTOR timetable construction and frequency expansion | Builds compiler typed arrays from routing trips | Transit preprocessing |
| Transfer graph, sibling-transfer, spatial-transfer, and raw transfer parsing | Builds compiler adjacency | Transit preprocessing |
| `src/transit/candidates/`, `places/`, and `service-profiles/` | Selects locality access stops | Transit preprocessing |
| GTFS stop CSV and prepared-stop parsing | Builds preparation inputs | Transit preprocessing |
| Locality-routing index construction and full metadata parser | Builds and authenticates a compiler input | Transit preprocessing |
| `scripts/transit/load-raptor-compiler.ts` and transit preparation/inspection scripts | Assemble current raw and processed inputs for compilation and diagnostics | Preprocessing/diagnostics |
| `src/car/preprocessing/` and car publication scripts | OSRM, anchors, matrix generation, publication | Car preprocessing |
| `createReachableLocalityMap` | Used only by a diagnostic script | Diagnostic internal, not locality public API |

The matrix compiler binds its prepared timetable and minimal
locality-ID/stop-index data to a preprocessing-only query closure. The former
opaque `TransitRuntime`/`WeakMap` bridge and separate runtime locality type file
are gone; production transit lookup does not import locality-routing or RAPTOR.

## RESOLVED_BROWSER_LEGACY

| Former module | Historical purpose | Final disposition |
| --- | --- | --- |
| `apps/commute-viewer/src/data/browser-timetable.ts` | Base64, `btoa`/`atob`, flattening, and RAPTOR reconstruction | Deleted |
| `apps/commute-viewer/src/data/runtime-data.ts` | Generated `window` schema, timetable/stop validation, and coordinates | Deleted; viewer now fetches canonical localities |
| `apps/commute-viewer/src/viewer-routing.ts` | Browser RAPTOR, stop sampling, client hexes, and timings | Deleted; API supplies final GeoJSON |
| `scripts/build-commute-viewer-data.ts` | Generated a 46.2 MB JavaScript routing bundle | Deleted |
| Root-source Vite alias | Allowed the browser to import compiler internals | Deleted |

Git history confirms that `browser-timetable.ts` was moved with high similarity
from the former validation UI data module in viewer commit `a44e3fc`. Its only
production consumers were the viewer data parser and viewer-data build script.
The viewer is now a small HTTP client of `apps/commute-api`; there is no browser
package, matrix loader, or worker implementation.

## Browser cleanup invariants

- Base64/timetable-browser codec re-exports are absent from transit.
- Raw RAPTOR query, result, and timetable structures remain internal compiler
  details; repository scripts and tests use explicit internal paths.
- Manifest parsers and diagnostics stay out of the package root export.
- `createReachableLocalityMap` remains a root diagnostic rather than package
  locality API.
- The generated `window.__SWISS_COMMUTE_VIEWER_DATA__` pipeline is deleted.
- Root core type checking has no Vite-client ambient dependency.

The server-mediated viewer migration removed these files without compatibility
aliases. Vue now owns only catalog search, controls, request state, and MapLibre
presentation.

## Public export classification

### Domain (`packages/commute/src/localities/index.ts`)

- `PUBLIC_CONSUMER_API`: `LocalityId`, `Locality`, `LocalityQuery`,
  `ReachableLocality`, `createLocalityId`, `normalizeCityName`,
  `LocalityResolver`.
- `DIAGNOSTIC_ONLY`: `createReachableLocalityMap`.
- `PREPROCESSING_ONLY`: `parseLocalitiesCsv` in the explicit Node entry.

### Transit

- `PUBLIC_CONSUMER_API`: opaque `TransitTravelTimeIndex`, its injected-data
  constructor, point lookup, and high-level locality reachability query.
- `INTERNAL_PREPROCESSING`: RAPTOR timetable/pattern types, routing
  queries/results, round state, transfer adjacency, fastest-journey policy,
  stop-index locality reduction, and the preprocessing-only query closure.
- `PREPROCESSING_ONLY`: timetable and transfer builders, candidates, places,
  service profiles, stops, routing-data/NDJSON, locality-index construction.
- `DIAGNOSTIC_ONLY`: RAPTOR diagnostics, debug locality journeys, typed-array
  byte accounting.

The canonical published transit representation is the same dense UInt8 matrix
format used by car. The Node entry authenticates only its manifest and binary;
RAPTOR structures do not cross the production boundary.

### Car (`packages/commute/src/car/index.ts`)

- `PUBLIC_CONSUMER_API`: opaque `CarTravelTimeIndex`,
  `createCarTravelTimeIndex`, `getCarTravelMinutes`, and
  `getReachableLocalitiesByCar`.
- `INTERNAL_RUNTIME`: strict car provenance parsing; row-major lookup and the
  `UInt8` matrix contract are owned by the package's shared matrix module.
- `PUBLIC_NODE_API`: the aggregate `loadCommuteRuntime` from `@jm/commute/node`;
  mode-specific path loaders remain package-internal.
- `PREPROCESSING_ONLY`: all OSRM, anchor, checkpoint, matrix-generation, and
  publication code.

## Implemented package shape

```text
packages/
  commute/          # canonical server/runtime package; exports . and ./node

apps/
  commute-api/      # Node visualization adapter over @jm/commute
  commute-viewer/   # presentation-only Vue/MapLibre client
```

No browser package was created. OSRM and RAPTOR remain offline compilers outside
the production package. The viewer uses the catalog and reachability results
through the API, while presentation policy remains outside `@jm/commute`.

## Implemented disposition

- The legacy Base64 timetable codec, generated viewer data, browser RAPTOR,
  stop-level sampling, and client hex construction were deleted after the
  viewer moved to the API.
- The broad RAPTOR, routing, timetable, and transfer barrels were removed.
  Runtime code, preprocessing scripts, and tests use explicit owner-module
  imports; the viewer has no compiler imports and no compatibility barrels
  were retained.
- The package transit module exposes only the opaque matrix-backed
  `TransitTravelTimeIndex`, injected-data constructor, point lookup, and
  high-level locality query.
- The RAPTOR compiler binds its timetable and minimal locality-ID/stop-index
  contract to a preprocessing-only query closure. The former opaque runtime
  handle and split runtime locality mapping type were removed.
- Transit preparation writes namespaced inputs below `data/processed/transit/`.
  Matrix compilation uses only `matrix-build/` as resumable workspace, then
  authenticates and promotes `manifest.json` plus `travel-times.bin` directly
  into `data/runtime/transit/`; there is no duplicate processed pair or
  separate byte-copy publisher.
- The standalone car runtime inspector and its diagnostic accessor were
  removed; runtime artifact verification remains the supported integrity check.
- Pickup/drop-off semantics and transfer-time encoding now point inward toward
  runtime-neutral owners instead of outward toward routing-data or transfer
  graph construction.
- Canonical locality, car, transit, and shared matrix runtime ownership moved
  to `packages/commute/src`; the deleted root files were not replaced by
  compatibility re-exports. Format parsers needed by repository tooling are
  reached only through the root-only `@commute-internal/*` alias, while raw CSV
  ingestion and diagnostic map construction remain in root `src/`.
- `packages/commute/tsconfig.json` builds the real Node ESM package and
  declarations. `tsconfig.core.json` checks the root compiler against that
  package, while the migrated viewer is checked by its own explicit tsconfig.
