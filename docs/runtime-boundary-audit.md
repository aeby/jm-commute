# Runtime boundary audit

This report records the pre-refactor state and ownership decisions for the
runtime-boundary cleanup. Decisions are based on import consumers and Git
history, not directory names alone.

The canonical direction is server-first:

```text
domain <- runtime core <- Node/server integration
                 ^
                 |
          offline preprocessing

future @jm/commute-browser -> future @jm/commute
```

Platform-neutral algorithms and typed arrays stay shared where that is natural.
Browser compatibility is not a constraint on Node loaders or preprocessing.

## KEEP_IN_RUNTIME_CORE

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `src/localities/types.ts`, locality identity, normalization, and resolver | Defines transport-independent `LocalityId`, `LocalityQuery`, and `ReachableLocality` semantics | Public domain |
| `src/transit/raptor/routing/` | Implements Range-RAPTOR and transfer relaxation without platform APIs | Internal transit runtime |
| RAPTOR timetable layouts and route-pattern access | Compact typed-array state consumed by the routing algorithm | Internal transit runtime; never consumer-facing mutable data |
| Transfer adjacency semantics and `USE_QUERY_TRANSFER_TIME` | Required by routing after a graph has been built | Internal transit runtime |
| Transit locality result reduction | Maps stop-space results to transport-independent locality results | Internal transit runtime behind the future facade |
| Pure GTFS date/time and pickup/drop-off primitives | Shared semantic primitives without file I/O | Runtime-neutral transit support |
| `src/travel-time-matrix/` | Opaque directional matrix lookup, strict descriptor, and one-row reachability scan | Transport-independent shared runtime |
| `src/car/travel-time-index.ts` | Thin car manifest/provenance façade over the shared matrix | Public car runtime implementation |

The transit routing implementation may retain mutable typed arrays internally.
They are hidden through entry-point ownership rather than copied.

## MOVE_TO_NODE_ENTRYPOINT

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `src/car/node.ts` | Filesystem loading and SHA-256 authentication of runtime assets | Canonical car Node entry point |
| `src/localities/node.ts` | Raw official-locality CSV ingestion | Node/preprocessing entry point, not domain runtime |
| `src/transit/gtfs/node.ts` | Filesystem/streaming GTFS CSV ingestion | Node-only preprocessing |
| `src/transit/locality-routing/node.ts` | Generated locality-index file loading | Node-only loading; not a consumer root export |
| `src/transit/routing-data/node.ts` | Processed manifest and NDJSON loading | Node-only preprocessing/publication |
| `src/transit/raptor/transfers/node.ts` | Streaming raw `transfers.txt` | Node-only preprocessing |

These splits were introduced while making the former validation UI bundle, but
they express a sound general boundary and are retained. A future
`src/transit/node.ts` should load published transit runtime assets. It must not
promote `scripts/load-raptor-inspection-timetable.ts`, which rebuilds state from
processed NDJSON and raw GTFS, into the production loader.

## MOVE_TO_PREPROCESSING

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `src/transit/routing-data/` | Normalized trips, manifest, NDJSON preparation and validation | Transit preprocessing/runtime publication |
| RAPTOR timetable construction and frequency expansion | Builds runtime typed arrays from routing trips | Transit preprocessing |
| Transfer graph, sibling-transfer, spatial-transfer, and raw transfer parsing | Builds runtime adjacency | Transit preprocessing; retain only adjacency semantics in runtime |
| `src/transit/candidates/`, `places/`, and `service-profiles/` | Selects locality access stops | Transit preprocessing |
| GTFS stop CSV and prepared-stop parsing | Builds preparation inputs | Transit preprocessing |
| Locality-routing index construction and full metadata parser | Builds and authenticates the generated index | Transit preprocessing/publication |
| `scripts/load-raptor-inspection-timetable.ts` and transit preparation/inspection scripts | Assemble current raw and processed inputs for diagnostics | Preprocessing/diagnostics |
| `src/car/preprocessing/` and car publication scripts | OSRM, anchors, matrix generation, publication | Car preprocessing |
| `createReachableLocalityMap` | Used only by a diagnostic script | Diagnostic internal, not locality public API |

Two current dependency leaks must be removed: runtime pickup/drop-off semantics
are owned by `routing-data`, and runtime locality entries import candidate
selection metadata. Runtime-only types will be separated so preprocessing may
depend inward on runtime, never the reverse.

## BROWSER_ONLY_LATER

| Current module | Why it exists | Recommended ownership |
| --- | --- | --- |
| `src/transit/raptor/browser-timetable.ts` | Base64, `btoa`/`atob`, flattening, and reconstruction for generated browser data | Move to viewer ownership now; later assess for `@jm/commute-browser` |
| `apps/commute-viewer/src/data/runtime-data.ts` | Viewer schema, `window` global loading, Base64 validation, autocomplete data, and stop coordinates | Viewer application |
| `apps/commute-viewer/src/viewer-routing.ts` | Paint yielding, request supersession, timings, stop sampling, hexes, and GeoJSON | Viewer application |
| `scripts/build-commute-viewer-data.ts` | Emits a generated JavaScript `window` global | Viewer-specific preprocessing; not a runtime contract |
| `apps/commute-viewer/vite.config.ts` alias to all of `src` | Lets the legacy viewer consume internal modules directly | Replace later with `@jm/commute-browser` |

Git history confirms that `browser-timetable.ts` was moved with high similarity
from the former validation UI data module in viewer commit `a44e3fc`. Its only
production consumers are the viewer data parser and viewer-data build script.
There is no generic browser fetch loader or worker implementation today.

## DELETE_AS_VIEWER_LEGACY

- Remove every Base64/timetable-browser codec re-export from
  `src/transit/raptor/index.ts`.
- Remove raw RAPTOR query/result/timetable structures from the future public
  transit entry. Internal scripts and tests may use explicit internal paths.
- Remove car manifest parsers and runtime diagnostics from `src/car/index.ts`;
  internal scripts may import their owning modules directly.
- Remove `createReachableLocalityMap` from `src/localities/index.ts`.
- Do not turn the generated `window.__SWISS_COMMUTE_VIEWER_DATA__` pipeline into
  the future browser package contract.
- Remove browser-first wording and the root core dependency on Vite client
  ambient types.

The viewer itself is not deleted or repaired as part of the canonical runtime.
Its current direct imports of RAPTOR arrays are legacy and may break. No
compatibility aliases will be added.

## Public export classification

### Domain (`src/localities/index.ts`)

- `PUBLIC_CONSUMER_API`: `LocalityId`, `Locality`, `LocalityQuery`,
  `ReachableLocality`, `createLocalityId`, `normalizeCityName`,
  `LocalityResolver`.
- `DIAGNOSTIC_ONLY`: `createReachableLocalityMap`.
- `PREPROCESSING_ONLY`: `parseLocalitiesCsv` in the explicit Node entry.

### Transit

- `PUBLIC_CONSUMER_API` later: an opaque `TransitRuntime` plus high-level
  locality reachability creation/loading/query functions.
- `INTERNAL_RUNTIME`: RAPTOR timetable/pattern types, routing queries/results,
  round state, transfer adjacency, fastest-journey policy, stop-index locality
  reduction.
- `PREPROCESSING_ONLY`: timetable and transfer builders, candidates, places,
  service profiles, stops, routing-data/NDJSON, locality-index construction.
- `DIAGNOSTIC_ONLY`: RAPTOR diagnostics, debug locality journeys, typed-array
  byte accounting.

No final transit facade is introduced until a canonical published transit
runtime-data format exists. The new root transit entry will therefore remain
deliberately small: it exposes the opaque runtime type and high-level query,
but no public constructor or loader merely to simulate a finished data API.

### Car (`src/car/index.ts`)

- `PUBLIC_CONSUMER_API`: opaque `CarTravelTimeIndex`,
  `createCarTravelTimeIndex`, `getCarTravelMinutes`, and
  `getReachableLocalitiesByCar`.
- `INTERNAL_RUNTIME`: strict car provenance parsing; row-major lookup and the
  `UInt8` matrix contract are owned by `src/travel-time-matrix`.
- `DIAGNOSTIC_ONLY`: the internal `getCarTravelTimeIndexDiagnostics` façade;
  it exposes only readonly storage diagnostics from the shared index.
- `PUBLIC_NODE_API`: `loadCarTravelTimeIndex` and explicit load paths in
  `src/car/node.ts`.
- `PREPROCESSING_ONLY`: all OSRM, anchor, checkpoint, matrix-generation, and
  publication code.

## Next package shape

```text
packages/
  commute/          # canonical server/runtime package; exports . and ./node
  commute-browser/  # thin loader/adapter depending on @jm/commute

apps/
  commute-viewer/   # eventually depends on @jm/commute-browser
```

`@jm/commute` must never depend on `@jm/commute-browser`. The browser package
must not reimplement locality identity, RAPTOR, transit locality reduction, or
car matrix lookup.

## Implemented disposition

- The Base64 timetable codec and its tests now live with the legacy viewer in
  `apps/commute-viewer/src/data/`; the canonical transit tree no longer exports
  or imports it.
- The broad RAPTOR, routing, timetable, and transfer barrels were removed.
  Runtime code, preprocessing scripts, tests, and the legacy viewer now use
  explicit owner-module imports; no compatibility barrels were retained.
- `src/transit/index.ts` exposes only the opaque `TransitRuntime` and the
  high-level locality query. The prepared-data constructor is an explicitly
  internal bridge until a canonical transit runtime-data format is published.
- Runtime locality routing now depends on a minimal locality-ID/stop-index
  contract. ZIP/city and candidate-selection diagnostics remain in the full
  preprocessing artifact types.
- Pickup/drop-off semantics and transfer-time encoding now point inward toward
  runtime-neutral owners instead of outward toward routing-data or transfer
  graph construction.
- `src/car/index.ts` and `src/localities/index.ts` were reduced to consumer
  contracts. Format parsers, diagnostics, CSV ingestion, and diagnostic map
  construction remain directly importable only from their owning internal or
  Node modules.
- `tsconfig.runtime.json` checks the public locality, transit, and car graph
  without Node or Vite ambient types. The root core project no longer depends
  on `vite/client`; fixture file I/O in tests is explicit Node code.
