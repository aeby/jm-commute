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
npm run viewer:dev
```

The downloaded source data is stored under `data/raw/` and is not committed to Git. Unit tests use a small local fixture and require no network access.

## Data source

Locality data comes from the official directory of towns and cities published by the Federal Office of Topography swisstopo.

Source attribution: **©swisstopo**

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
