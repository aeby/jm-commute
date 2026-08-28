import { readFile } from 'node:fs/promises';
import { buildTransitPlaces } from '@core/transit/places';
import { parseTransitStopsJson } from '@core/transit/stops';

import { writeUtf8FileAtomically } from '../write-utf8-file-atomically';
import { TRANSIT_PLACES_PATH, TRANSIT_STOPS_PATH } from './paths';

const INPUT_RELATIVE_PATH = 'data/processed/transit/stops.json';
const OUTPUT_RELATIVE_PATH = 'data/processed/transit/places.json';

const json = await readFile(TRANSIT_STOPS_PATH, 'utf8');
const stops = parseTransitStopsJson(json, INPUT_RELATIVE_PATH);
const places = buildTransitPlaces(stops);
const stationIds = new Set<string>();
let inputStationCount = 0;
let inputStopCount = 0;

for (const stop of stops) {
  if (stop.kind === 'STATION') {
    inputStationCount += 1;
    stationIds.add(stop.id);
  } else {
    inputStopCount += 1;
  }
}

let parentStationPlaceCount = 0;

for (const place of places) {
  if (stationIds.has(place.id)) {
    parentStationPlaceCount += 1;
  }
}

const standaloneStopPlaceCount = places.length - parentStationPlaceCount;
const excludedStationCount = inputStationCount - parentStationPlaceCount;

await writeUtf8FileAtomically(
  TRANSIT_PLACES_PATH,
  `${JSON.stringify(places, null, 2)}\n`,
);

console.log(`Input stations: ${inputStationCount}`);
console.log(`Input stops/platforms: ${inputStopCount}`);
console.log(`Parent-station transit places: ${parentStationPlaceCount}`);
console.log(`Standalone-stop transit places: ${standaloneStopPlaceCount}`);
console.log(
  `Stations without children excluded: ${excludedStationCount}`,
);
console.log(`Total transit places: ${places.length}`);
console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
