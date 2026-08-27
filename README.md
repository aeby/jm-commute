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

Locality-to-stop mapping, timetable routing, stop selection, and visualization are deliberately out of scope.

## Development

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run data:prepare:stops
```

The downloaded source data is stored under `data/raw/` and is not committed to Git. Unit tests use a small local fixture and require no network access.

## Data source

Locality data comes from the official directory of towns and cities published by the Federal Office of Topography swisstopo.

Source attribution: **©swisstopo**

### Public-transport data

Static Swiss public-transport data comes from the GTFS timetable published by opentransportdata.swiss.

For the current milestone, only `stops.txt` is parsed. Timetable routing is not implemented yet.
