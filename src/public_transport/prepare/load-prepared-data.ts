import { readFile } from 'node:fs/promises';

import { parseLocalitiesCsv } from '../../localities/node';
import {
  buildLocalitySourceStopEntries,
  type LocalitySourceStopEntry,
  type LocalitySourceStopSelectionOptions,
} from './build-locality-source-stop-entries';
import {
  loadFixedDateActiveServices,
  type FixedDateFeedInfo,
} from './gtfs/load-fixed-date-feed';
import {
  parseGtfsTimeToSeconds,
  validateGtfsDate,
} from './gtfs';
import { readGtfsTransfers } from './gtfs/read-gtfs-transfers';
import type { ParsedGtfsTransfer } from './gtfs/types';
import { buildTransitPlaces } from './places';
import {
  validateFixedDayRoutingManifestScenario,
  type FixedDayRoutingManifest,
  type RoutingTrip,
} from './routing';
import { loadFixedDayRoutingDataset } from './routing/load-fixed-day-routing-dataset';
import {
  parseTransitStopsJson,
  type TransitStop,
} from './stops';
import type { PublicTransportScenario } from './types';

export interface LoadPreparedDataOptions {
  readonly gtfsDirectory: string;
  readonly stopsPath: string;
  readonly routingDirectory: string;
  readonly localitiesPath: string;
  readonly transfersPath: string;
  readonly scenario: PublicTransportScenario;
  readonly localitySelection: LocalitySourceStopSelectionOptions;
}

export interface PreparedData {
  readonly manifest: FixedDayRoutingManifest;
  readonly trips: AsyncIterable<RoutingTrip>;
  readonly stops: readonly TransitStop[];
  readonly localities: readonly LocalitySourceStopEntry[];
  readonly activeServiceIds: ReadonlySet<string>;
  readonly transferRules: AsyncIterable<ParsedGtfsTransfer>;
  readonly routingWindowStartSeconds: number;
  readonly routingWindowEndSeconds: number;
}

async function readUtf8(path: string, description: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${description} at "${path}".`, {
      cause: error,
    });
  }
}

function toGtfsDate(serviceDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new RangeError(
      `Service date must use YYYY-MM-DD format: "${serviceDate}".`,
    );
  }

  const gtfsDate = serviceDate.replaceAll('-', '');
  validateGtfsDate(gtfsDate, 'Configured service date');
  return gtfsDate;
}

function validateFeedVersion(
  manifest: FixedDayRoutingManifest,
  rawFeedInfo: FixedDateFeedInfo,
): void {
  if (manifest.sourceFeedVersion !== rawFeedInfo.version) {
    throw new Error(
      `Raw GTFS feed version ${JSON.stringify(rawFeedInfo.version ?? 'not supplied')} does not match prepared routing feed version ${JSON.stringify(manifest.sourceFeedVersion ?? 'not supplied')}. Rebuild the prepared public-transport data from the current raw feed.`,
    );
  }
}

/** Loads and validates the complete input required by `buildNetwork`. */
export async function loadPreparedData(
  options: LoadPreparedDataOptions,
): Promise<PreparedData> {
  const [routing, stopsJson, localitiesCsv, activeServices] =
    await Promise.all([
      loadFixedDayRoutingDataset(options.routingDirectory),
      readUtf8(options.stopsPath, 'prepared public-transport stops'),
      readUtf8(options.localitiesPath, 'locality CSV'),
      loadFixedDateActiveServices(
        options.gtfsDirectory,
        toGtfsDate(options.scenario.serviceDate),
      ),
    ]);

  validateFixedDayRoutingManifestScenario(routing.manifest, {
    serviceDate: options.scenario.serviceDate,
    routingWindowStart: options.scenario.routingWindowStart,
    routingWindowEnd: options.scenario.routingWindowEnd,
  });
  validateFeedVersion(routing.manifest, activeServices.feedInfo);

  const stops = parseTransitStopsJson(stopsJson, options.stopsPath);
  const places = buildTransitPlaces(stops);
  const localities = buildLocalitySourceStopEntries(
    parseLocalitiesCsv(localitiesCsv),
    places,
    options.localitySelection,
  );

  return {
    manifest: routing.manifest,
    trips: routing.trips,
    stops,
    localities,
    activeServiceIds: activeServices.activeServiceIds,
    transferRules: readGtfsTransfers(options.transfersPath),
    routingWindowStartSeconds: parseGtfsTimeToSeconds(
      options.scenario.routingWindowStart,
    ),
    routingWindowEndSeconds: parseGtfsTimeToSeconds(
      options.scenario.routingWindowEnd,
    ),
  };
}
