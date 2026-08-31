# Generation and consumption boundary

The production boundary is the pair of finished locality matrices.

```text
src/public_transport ─→ data/runtime/public_transport/travel-times.bin
src/road ─────────────→ data/runtime/road/travel-times.bin
                                      │
official localities ─→ localities.json│
                                      ▼
                              packages/commute
```

## Generation owns routing

`src/public_transport` owns GTFS preparation, timetable construction,
transfers, locality access, RAPTOR, checkpointing, and public-transport matrix
generation.

`src/road` owns OpenStreetMap preparation, OSRM configuration, locality road
anchors, table requests, checkpointing, and road matrix generation.

Both generators publish the same byte format but otherwise remain independent.
There is no generic routing framework between them.

## Runtime owns artifacts

`src/runtime/matrix-artifact.ts` contains the only shared publication concept:
atomically write a finished matrix and its small metadata file. The manifest
contains only:

- generation date;
- matrix fingerprint;
- a short source description.

It does not contain locality IDs, matrix dimensions, layout constants, or a
copy of any data that belongs in `localities.json` or the matrix itself.

`scripts/commute/package-data.ts` assembles the runtime files. It sorts the
canonical locality records into matrix order, checks the two obvious `N × N`
byte lengths, and copies the artifacts into the standalone package. It does
not authenticate, sample, benchmark, or independently reproduce matrix
results.

## Standalone owns lookup

`packages/commute` loads:

```text
localities.json
public_transport/travel-times.bin
road/travel-times.bin
```

The package builds two maps for locality resolution and indexes matrix cells
directly. It exposes `resolve`, `travelTime`, and the viewer-oriented
`reachableLocalities` row scan. It does not parse manifests at startup.

The standalone package contains no OpenStreetMap, OSRM, GTFS, timetable,
transfer, RAPTOR, graph-building, checkpoint, provenance-validation, or matrix-
generation code.

## Applications

`apps/commute-api` joins reachable locality IDs to their coordinates and emits
GeoJSON. `apps/commute-viewer` consumes that HTTP representation. Both use the
same mode vocabulary as the standalone package: `public_transport` and
`road`.
