import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGtfsStopsCsv } from '../src/transit/stops';
import { writeUtf8FileAtomically } from './write-utf8-file-atomically';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT_PATH = join(PROJECT_ROOT, 'data', 'raw', 'gtfs', 'stops.txt');
const OUTPUT_RELATIVE_PATH = 'data/processed/transit-stops.json';
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

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
  OUTPUT_PATH,
  `${JSON.stringify(stops, null, 2)}\n`,
);

console.log(`Stations: ${stationCount}`);
console.log(`Stops/platforms: ${stopCount}`);
console.log(`Child stops/platforms: ${childStopCount}`);
console.log(`Standalone stops: ${standaloneStopCount}`);
console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
