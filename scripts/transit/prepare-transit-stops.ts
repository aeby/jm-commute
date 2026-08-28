import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parseGtfsStopsCsv } from '@core/transit/stops';

import { writeUtf8FileAtomically } from '../write-utf8-file-atomically';
import {
  RAW_GTFS_DIRECTORY,
  TRANSIT_STOPS_PATH,
} from './paths';

const INPUT_PATH = resolve(RAW_GTFS_DIRECTORY, 'stops.txt');
const OUTPUT_RELATIVE_PATH = 'data/processed/transit/stops.json';

const csv = await readFile(INPUT_PATH, 'utf8');
const stops = parseGtfsStopsCsv(csv);

let stationCount = 0;
let childStopCount = 0;
let standaloneStopCount = 0;

for (const stop of stops) {
  if (stop.kind === 'STATION') {
    stationCount += 1;
  } else if (stop.parentStationId === undefined) {
    standaloneStopCount += 1;
  } else {
    childStopCount += 1;
  }
}

const stopCount = childStopCount + standaloneStopCount;

await writeUtf8FileAtomically(
  TRANSIT_STOPS_PATH,
  `${JSON.stringify(stops, null, 2)}\n`,
);

console.log(`Stations: ${stationCount}`);
console.log(`Stops/platforms: ${stopCount}`);
console.log(`Child stops/platforms: ${childStopCount}`);
console.log(`Standalone stops: ${standaloneStopCount}`);
console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
