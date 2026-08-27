# Swiss Commute Reachability

An offline TypeScript project for estimating which jobs are reachable by public transport in Switzerland.

Users and jobs are identified approximately by postcode and/or city name. The system will map these locations to public-transport stops and use Swiss timetable data to calculate realistic travel times around lakes, mountains, valleys, and other geographic obstacles.

## Planned pipeline

1. Resolve postcode and city names to official locality coordinates.
2. Map each locality to nearby public-transport stops.
3. Load Swiss GTFS timetable data.
4. Calculate reachable stops with Minotor/RAPTOR.
5. Match reachable localities to jobs.
6. Optionally visualize the result as an isochrone map.

## Current milestone

The current implementation resolves postcode and city inputs to official WGS84 locality coordinates and prepares a minimal GTFS station-and-stop dataset.

GTFS station records and their child platforms are normalized into logical transit places, while standalone stops remain individual transit places.

Final single-place selection, timetable routing, and visualization are deliberately out of scope.

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run data:prepare:stops
npm run data:prepare:places
npm run data:prepare:service-profiles
```

The downloaded source data is stored under `data/raw/` and is not committed to Git. Unit tests use a small local fixture and require no network access.

## Data source

Locality data comes from the official directory of towns and cities published by the Federal Office of Topography swisstopo.

Source attribution: **©swisstopo**

### Public-transport data

Static Swiss public-transport data comes from the GTFS timetable published by opentransportdata.swiss.

Timetable files are currently used only to build fixed-time transit-place service profiles. Timetable routing is not implemented yet.

### Representative timetable scenario

Commute estimates use a fixed representative service date and time:

- Monday, 7 September 2026
- departure at 08:00
- transit-place activity measured from 07:00 until 09:00

Local access candidates normally include every transit place within 700 metres of the locality coordinate. When none exists, the ten geographically nearest places are returned as fallback candidates.

Candidate ranking uses all-mode route diversity and service frequency. Railway connectivity is additional metadata and does not exclude or suppress buses, trams, ferries, cableways, or other scheduled public transport.
