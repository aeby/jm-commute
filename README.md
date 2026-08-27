# Swiss Commute Reachability

An offline TypeScript project for estimating which jobs are reachable by public transport in Switzerland.

Users and jobs are identified approximately by postcode and/or city name. The system will map these locations to public-transport stops and use Swiss timetable data to calculate realistic travel times around lakes, mountains, valleys, and other geographic obstacles.

## Planned pipeline

1. Resolve postcode and city names to official locality coordinates.
2. Map each locality to nearby public-transport stops.
3. Load Swiss GTFS timetable data.
4. Calculate reachable stops with RAPTOR.
5. Match reachable localities to jobs.
6. Optionally visualize the result as an isochrone map.

## Current milestone

The current implementation prepares a compact fixed-day timetable and runs multi-source, one-to-all public-transport reachability queries from resolved localities.

GTFS station records and their child platforms are normalized into logical transit places, while standalone stops remain individual transit places.

Journey reconstruction, explicit platform transfers, locality reachability, job matching, and visualization remain out of scope.

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
```

The downloaded source data is stored under `data/raw/` and is not committed to Git. Unit tests use a small local fixture and require no network access.

## Data source

Locality data comes from the official directory of towns and cities published by the Federal Office of Topography swisstopo.

Source attribution: **©swisstopo**

### Public-transport data

Static Swiss public-transport data comes from the GTFS timetable published by opentransportdata.swiss.

Timetable files are used to build fixed-time transit-place service profiles, fixed-day routing input, and an in-memory RAPTOR timetable.

### Central configuration

The reference service date, departure time, service-profile window, local-access radius, fallback candidate count, maximum transfers, and minimum transfer time are configured in `src/config.ts`.

### Representative timetable scenario

Commute estimates use a fixed representative service date and time:

- Monday, 7 September 2026
- departure at 08:00
- transit-place activity measured from 07:00 until 09:00

Local access candidates normally include every transit place within 700 metres of the locality coordinate. When none exists, the ten geographically nearest places are returned as fallback candidates.

Candidate ranking uses all-mode route diversity and service frequency. Railway connectivity is additional metadata and does not exclude or suppress buses, trams, ferries, cableways, or other scheduled public transport.

### Fixed-day routing data

Routing data is prepared for the configured representative Monday. Scheduled trips that can still be boarded at or after 08:00 are retained with their complete stop sequence.

GTFS frequency windows are preserved in the fixed-day input and expanded only when the compact timetable is built.

### Compact RAPTOR timetable

The fixed-day trips are streamed into deterministic dense stop IDs and compact, non-overtaking route patterns. Stop times use typed arrays, pickup and drop-off values use two-bit packing, and each stop has route-pattern adjacency for later RAPTOR scans.

Frequency templates are expanded at their declared headways during timetable construction. Both `exact_times=0` and `exact_times=1` use the same deterministic expansion; treating non-exact headways as exact instances is an intentional commute-estimation approximation.

### RAPTOR reachability

The router performs a multi-source, one-to-all RAPTOR query against the compact fixed-day timetable.

All selected origin routing stops are seeded at the configured 08:00 departure time. The result contains the earliest arrival time at every reachable stop, bounded by the requested maximum commute duration.

The initial implementation supports transfers between services sharing the same routing stop. Explicit transfers between different platforms or nearby stops are implemented separately.
