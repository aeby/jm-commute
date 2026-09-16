# `@jobmate/commute-api`

Loopback-first Node HTTP adapter for the server-only `@jobmate/commute` runtime.
It exposes the canonical locality catalog and map-ready reachability GeoJSON;
it never serves or imports commute matrices in browser code.

```text
GET  /health
GET  /api/localities
POST /api/reachability
```

`GET /api/localities` includes the optional `publicTransportStationName` on each
locality. `POST /api/reachability` includes the same field in `origin`. It is the
physical station or standalone stop selected for the published public-transport
matrix, even when the requested mode is `road`. The viewer shows it as a small
gray label below Location when public transport is selected. Missing names are
shown as unavailable; they are never inferred from the locality's city name.

The metadata comes directly from the locality index in `@jobmate/commute`.
After rebuilding the package data, restart the API and reload the viewer.

The reachability request contains exactly `originLocalityId`, `mode` (`road` or
`public_transport`), and an integer `maxTravelMinutes` from 0 through 240. Invalid input
returns a JSON error envelope and HTTP 400. Unsupported methods return 405,
unsupported request media types return 415, oversized bodies return 413, and
unknown routes return 404.

The returned GeoJSON uses canonical locality representative points aggregated
into deterministic 2,000 m pointy-top Web Mercator cells. Rendered polygons are
scaled to 0.88 around their centres; this gap does not affect cell assignment.

From the repository root:

```bash
npm run commute:api:dev
npm run commute:api:start
npm run commute:api:typecheck
```

Running `npm run dev` directly in this workspace is also supported. Its
`predev` step rebuilds `@jobmate/commute` before starting the
TypeScript watcher, so the generated package entry points cannot be stale.

Defaults are `127.0.0.1:3001`. Override them with `COMMUTE_API_HOST` and
`COMMUTE_API_PORT`. Development CORS allows only
`http://127.0.0.1:5173` and `http://localhost:5173` by default.
`COMMUTE_API_CORS_ORIGIN` replaces that list with one exact origin; an empty
value disables CORS.
