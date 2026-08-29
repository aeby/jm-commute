import { PROJECT_CONFIG } from '@core/config';
import { prepareData } from '@core/public_transport';

import {
  PREPARED_ROUTING_DIRECTORY,
  PREPARED_STOPS_PATH,
  RAW_GTFS_DIRECTORY,
} from './paths';

const { referenceScenario } = PROJECT_CONFIG.publicTransport;
const result = await prepareData({
  gtfsDirectory: RAW_GTFS_DIRECTORY,
  stopsPath: PREPARED_STOPS_PATH,
  routingDirectory: PREPARED_ROUTING_DIRECTORY,
  scenario: {
    serviceDate: referenceScenario.serviceDate,
    routingWindowStart: referenceScenario.morningWindow.start,
    routingWindowEnd: referenceScenario.morningWindow.end,
  },
});

console.log(`Prepared ${result.stopCount} stops.`);
console.log(
  `Prepared ${result.routingManifest.tripCount} trips with ` +
    `${result.routingManifest.stopTimeCount} stop times for ` +
    `${result.routingManifest.serviceDate}.`,
);
console.log(`Stops: ${PREPARED_STOPS_PATH}`);
console.log(`Routing data: ${PREPARED_ROUTING_DIRECTORY}`);
