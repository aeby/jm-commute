# `@jobmate/commute`

A small, read-only lookup package for precomputed Swiss travel times.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

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

## Quick usage

Find destinations within a commute budget with `reachableLocalities`, or check
a trip between two localities with `travelTime`. Both support `public_transport`
and `road`:

```ts
import { loadCommuteRuntime } from '@jobmate/commute/node';

const runtime = await loadCommuteRuntime();
const origin = runtime.resolve({ postalCode: '8001', city: 'Zürich' });

// Find all localities reachable from Zürich within 45 minutes by public transport.
if (origin) {
  const reachable = runtime.reachableLocalities(origin, 30, 'public_transport');

  console.table(reachable.map(({ localityId, travelMinutes }) => {
    const locality = runtime.resolve(localityId);
    return {
      postalCode: locality?.postalCode,
      city: locality?.city,
      station: locality?.publicTransportStationName,
      travelMinutes,
    };
  }));
}

// Look up the travel time from Zürich to Bern for either mode.
const destination = runtime.resolve({ postalCode: '3011', city: 'Bern' });
if (origin && destination) {
  const roadMinutes = runtime.travelTime(origin, destination, 'road');
  const publicTransportMinutes = runtime.travelTime(
    origin,
    destination,
    'public_transport',
  );
  console.log({ roadMinutes, publicTransportMinutes });
}
```

- `reachableLocalities(origin, maxTravelMinutes, mode)` returns all matching
  `{ localityId, travelMinutes }` entries, sorted by travel time. The limit is
  inclusive and must be a whole number from 0 to 240 minutes. Each result
  represents a locality; resolving its ID gives its name, coordinates, and
  selected public-transport station, when available.
- `travelTime(origin, destination, mode)` returns whole travel minutes, or
  `undefined` when the destination is unavailable within four hours.

`resolve` accepts either a canonical locality ID or a postal-code/city query.

`Locality.publicTransportStationName` is the exact name of the physical station
or standalone stop selected when compiling the public-transport matrix. It is
available on `runtime.localities` and `runtime.resolve(...)`; it does not describe
road routing or individual journey platforms. The field is absent when no active
station was available for selection.

Names are stored directly in `data/localities.json`, alongside each locality's
ID and coordinates. Runtime loading reads this array and the two matrices;
it does not read the provenance manifests.

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
