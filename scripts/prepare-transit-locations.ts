import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGtfsStops } from '../src/transit/gtfs';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT_PATH = join(PROJECT_ROOT, 'data', 'raw', 'gtfs', 'stops.txt');
const OUTPUT_RELATIVE_PATH = 'data/generated/transit-locations.json';
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

const csv = await readFile(INPUT_PATH, 'utf8');
const locations = parseGtfsStops(csv);

let stationCount = 0;
let childStopCount = 0;
let standaloneStopCount = 0;

for (const location of locations) {
  if (location.kind === 'STATION') {
    stationCount += 1;
  } else if (location.parentId === undefined) {
    standaloneStopCount += 1;
  } else {
    childStopCount += 1;
  }
}

const stopCount = childStopCount + standaloneStopCount;

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(locations, null, 2)}\n`, 'utf8');

console.log(`Parsed locations: ${locations.length}`);
console.log(`Stations: ${stationCount}`);
console.log(`Stops/platforms: ${stopCount}`);
console.log(`Child stops/platforms: ${childStopCount}`);
console.log(`Standalone stops: ${standaloneStopCount}`);
console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
