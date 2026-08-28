import styles from './style.css?inline';

import { PROJECT_CONFIG } from '../config';
import { normalizeCityName } from '../localities';
import { resolveFastestReachableLocalitiesDebug } from '../transit/locality-routing';
import {
  runRaptorFastestWindow,
  type FastestWindowRoutingDiagnostics,
} from '../transit/raptor';
import { parseGtfsTimeToSeconds } from '../transit/gtfs';
import {
  decodeValidationTimetable,
  reconstructValidationTimetable,
  type SwissCommuteValidationData,
} from './validation-data';
import { initializeLocalityAutocomplete } from './locality-autocomplete-controller';
import {
  createValidationLocalityRoutingIndex,
  validateValidationData,
} from './validation-runtime-data';
import {
  ValidationViewModel,
  type DestinationTravelStatus,
  type ValidationCalculation,
} from './view-model';

const UI_CONFIG = PROJECT_CONFIG.validationUi;

function requireElement<TElement extends HTMLElement>(
  id: string,
  constructor: { new (): TElement },
): TElement {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Validation UI is missing element #${id}.`);
  }
  return element;
}

function createTable(
  headings: readonly string[],
  rows: readonly (readonly string[])[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headings.forEach((heading) => {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = heading;
    headRow.append(cell);
  });
  head.append(headRow);
  const body = document.createElement('tbody');
  rows.forEach((row) => {
    const tableRow = document.createElement('tr');
    row.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      tableRow.append(cell);
    });
    body.append(tableRow);
  });
  table.append(head, body);
  wrap.append(table);
  return wrap;
}

function formatServiceTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function main(): void {
  const style = document.createElement('style');
  style.textContent = styles;
  document.head.append(style);

  const validationDataProperty =
    '__SWISS_COMMUTE_VALIDATION_DATA__' as const;
  const validationWindow = window as typeof window &
    Partial<Record<typeof validationDataProperty, SwissCommuteValidationData>>;
  const data = validateValidationData(
    validationWindow[validationDataProperty],
  );
  const decodeStart = performance.now();
  const decodedTimetable = decodeValidationTimetable(data.timetable);
  const decodeMilliseconds = performance.now() - decodeStart;
  const reconstructionStart = performance.now();
  const timetable = reconstructValidationTimetable(decodedTimetable);
  const reconstructionMilliseconds = performance.now() - reconstructionStart;
  const localityIndex = createValidationLocalityRoutingIndex(data);
  const localityById = new Map(
    data.localities.map((locality) => [locality.localityId, locality]),
  );
  const entryById = new Map(
    localityIndex.entries.map((entry) => [entry.localityId, entry]),
  );
  const windowStartSeconds = parseGtfsTimeToSeconds(
    data.routingWindowStart,
  );
  const windowEndSeconds = parseGtfsTimeToSeconds(data.routingWindowEnd);
  let routingMilliseconds = 0;
  let reductionMilliseconds = 0;
  let routingDiagnostics: FastestWindowRoutingDiagnostics | undefined;
  const model = new ValidationViewModel(
    localityIndex,
    data.hubCandidatesByLocality,
    {
      run: (originStopIndexes, maxTravelTimeMinutes) => {
        const start = performance.now();
        const result = runRaptorFastestWindow(
          timetable,
          {
            originStopIndexes: [...originStopIndexes],
            windowStartSeconds,
            windowEndSeconds,
            maxTravelTimeSeconds: maxTravelTimeMinutes * 60,
            maxTransfers: PROJECT_CONFIG.transit.routing.maxTransfers,
            minTransferTimeSeconds:
              PROJECT_CONFIG.transit.routing.minTransferTimeSeconds,
          },
          (value) => {
            routingDiagnostics = value;
          },
        );
        routingMilliseconds = performance.now() - start;
        return result;
      },
      resolve: (result) => {
        const start = performance.now();
        const reachable = resolveFastestReachableLocalitiesDebug(
          result,
          localityIndex,
        );
        reductionMilliseconds = performance.now() - start;
        return reachable;
      },
    },
  );

  const travelSlider = requireElement('travel-time', HTMLInputElement);
  const travelValue = requireElement('travel-time-value', HTMLOutputElement);
  const travelMin = requireElement('travel-time-min', HTMLSpanElement);
  const travelMax = requireElement('travel-time-max', HTMLSpanElement);
  const calculateButton = requireElement('calculate', HTMLButtonElement);
  const calculationStatus = requireElement(
    'calculation-status',
    HTMLParagraphElement,
  );
  const selectionMode = requireElement('selection-mode', HTMLSpanElement);
  const fallbackWarning = requireElement('fallback-warning', HTMLDivElement);
  const hubCandidates = requireElement('hub-candidates', HTMLDivElement);
  const destinationStatus = requireElement(
    'destination-status',
    HTMLElement,
  );
  const destinationDetails = requireElement(
    'destination-details',
    HTMLDetailsElement,
  );
  const destinationDetailsContent = requireElement(
    'destination-details-content',
    HTMLPreElement,
  );
  const reachableTotal = requireElement('reachable-total', HTMLElement);
  const reachabilityBuckets = requireElement(
    'reachability-buckets',
    HTMLDivElement,
  );
  const reachableFilter = requireElement(
    'reachable-filter',
    HTMLInputElement,
  );
  const reachableLocalities = requireElement(
    'reachable-localities',
    HTMLDivElement,
  );
  const diagnostics = requireElement(
    'performance-diagnostics',
    HTMLPreElement,
  );

  travelSlider.min = String(UI_CONFIG.minTravelTimeMinutes);
  travelSlider.max = String(UI_CONFIG.maxTravelTimeMinutes);
  travelSlider.step = String(UI_CONFIG.travelTimeStepMinutes);
  travelSlider.value = String(UI_CONFIG.defaultTravelTimeMinutes);
  travelMin.textContent = `${UI_CONFIG.minTravelTimeMinutes} min`;
  travelMax.textContent = `${UI_CONFIG.maxTravelTimeMinutes} min`;

  const updateTravelLabel = (): void => {
    travelValue.textContent = `${travelSlider.valueAsNumber} minutes`;
  };
  updateTravelLabel();

  const updateDiagnostics = (totalMilliseconds?: number): void => {
    const lines = [
      `Feed version: ${data.feedVersion}`,
      `Data decode: ${decodeMilliseconds.toFixed(1)} ms`,
      `Timetable reconstruction: ${reconstructionMilliseconds.toFixed(1)} ms`,
    ];
    if (totalMilliseconds !== undefined) {
      lines.push(
        `Routing: ${routingMilliseconds.toFixed(1)} ms`,
        `Locality reduction: ${reductionMilliseconds.toFixed(1)} ms`,
        `Total calculation: ${totalMilliseconds.toFixed(1)} ms`,
        `Meaningful departure slots: ${routingDiagnostics?.departureSlotCount ?? 0}`,
        `Range runs: ${routingDiagnostics?.rangeRuns ?? 0}`,
        `Runs without duration improvements: ${routingDiagnostics?.runsWithoutDurationImprovements ?? 0}`,
        `Patterns scanned: ${routingDiagnostics?.patternsScanned ?? 0}`,
        `Cross-run prunes: ${routingDiagnostics?.crossRunPrunes ?? 0}`,
        `Original routing origins: ${routingDiagnostics?.originalSeedStops ?? 0}`,
        `Maximum initial-access routing stops: ${routingDiagnostics?.maximumAdditionalInitialAccessStops ?? 0}`,
        `Initial-access edges examined: ${routingDiagnostics?.initialAccessEdgesExamined ?? 0}`,
      );
    }
    diagnostics.textContent = lines.join('\n');
  };
  updateDiagnostics();
  console.info(
    `Validation data decode: ${decodeMilliseconds.toFixed(1)} ms; timetable reconstruction: ${reconstructionMilliseconds.toFixed(1)} ms.`,
  );

  let destinationLocalityId: string | undefined;

  const renderHubs = (localityId: string): void => {
    const selection = model.selectOrigin(localityId);
    selectionMode.textContent = selection.entry.selectionMode;
    fallbackWarning.hidden = !selection.isFallback;
    hubCandidates.className = '';
    const displayed = selection.hubs.slice(0, UI_CONFIG.displayedHubLimit);
    if (displayed.length === 0) {
      hubCandidates.className = 'empty-state';
      hubCandidates.textContent = 'No transit candidates are available.';
      return;
    }
    const caption = document.createElement('p');
    caption.className = 'list-caption';
    caption.textContent = `Showing ${displayed.length} of ${selection.hubs.length} ranked candidates.`;
    hubCandidates.replaceChildren(
      caption,
      createTable(
        [
          'Hub / stop',
          'Distance',
          'Routes',
          'Departures',
          'Rail routes',
          'Rail departures',
        ],
        displayed.map((hub) => [
          hub.name,
          `${hub.distanceMeters.toFixed(0)} m`,
          String(hub.routeCount),
          String(hub.departureCount),
          String(hub.railRouteCount),
          String(hub.railDepartureCount),
        ]),
      ),
    );
    calculationStatus.textContent =
      selection.entry.stopIndexes.length === 0
        ? 'This locality has no active routing stops during the morning timetable.'
        : `${selection.entry.stopIndexes.length} active origin routing stops selected.`;
  };

  const clearCalculationView = (): void => {
    reachableTotal.textContent = 'Not calculated';
    reachabilityBuckets.replaceChildren();
    reachableFilter.value = '';
    reachableFilter.disabled = true;
    reachableLocalities.className = 'empty-state';
    reachableLocalities.textContent =
      'Run a calculation to list reachable localities.';
    model.invalidateCalculation();
  };

  const renderReachableList = (): void => {
    const calculation = model.getCalculation();
    if (calculation === undefined) {
      return;
    }
    const query = normalizeCityName(reachableFilter.value);
    const matches = calculation.reachableLocalities.filter((reachable) => {
      const locality = localityById.get(reachable.localityId);
      return (
        locality !== undefined &&
        (query.length === 0 ||
          locality.postalCode.startsWith(query) ||
          normalizeCityName(locality.city).includes(query))
      );
    });
    const displayed = matches.slice(
      0,
      UI_CONFIG.displayedReachableLocalityLimit,
    );
    const caption = document.createElement('p');
    caption.className = 'list-caption';
    caption.textContent = `Showing ${displayed.length} of ${matches.length} matching reachable localities.`;
    reachableLocalities.className = '';
    reachableLocalities.replaceChildren(
      caption,
      createTable(
        ['Travel time', 'ZIP', 'City'],
        displayed.map((reachable) => {
          const locality = localityById.get(reachable.localityId);
          return [
            `${reachable.travelMinutes} min`,
            locality?.postalCode ?? '—',
            locality?.city ?? reachable.localityId,
          ];
        }),
      ),
    );
  };

  const renderDestination = (): void => {
    const status: DestinationTravelStatus = model.getDestinationStatus();
    destinationDetails.hidden = destinationLocalityId === undefined;
    if (status.kind === 'NO_DESTINATION') {
      destinationStatus.textContent = 'No destination selected';
      destinationDetails.hidden = true;
      return;
    }
    if (status.kind === 'NOT_CALCULATED') {
      destinationStatus.textContent = 'Calculate from the selected origin';
    } else if (status.kind === 'REACHABLE') {
      destinationStatus.textContent = `Fastest estimated travel time: ${status.travelMinutes} minutes`;
    } else {
      destinationStatus.textContent = `Not reachable within ${status.maxTravelTimeMinutes} minutes`;
    }

    if (destinationLocalityId !== undefined) {
      const entry = entryById.get(destinationLocalityId);
      const sourceStops = entry
        ? [...entry.stopIndexes]
            .slice(0, 10)
            .map((stopIndex) => timetable.sourceStopIds[stopIndex] ?? '?')
        : [];
      destinationDetailsContent.textContent = [
        `Locality: ${destinationLocalityId}`,
        `Candidate routing stops: ${entry?.stopIndexes.length ?? 0}`,
        `Best departure: ${status.kind === 'REACHABLE' ? formatServiceTime(status.departureTimeSeconds) : 'not reached in current calculation'}`,
        `Arrival: ${status.kind === 'REACHABLE' ? formatServiceTime(status.arrivalTimeSeconds) : 'not reached in current calculation'}`,
        `Source stop IDs (first 10): ${sourceStops.join(', ') || 'none'}`,
      ].join('\n');
    }
  };

  const renderCalculation = (
    calculation: ValidationCalculation,
    totalMilliseconds: number,
  ): void => {
    reachableTotal.textContent = `${calculation.reachableLocalities.length} localities`;
    reachabilityBuckets.replaceChildren(
      ...calculation.buckets.map((bucket) => {
        const metric = document.createElement('div');
        metric.className = 'metric';
        const label = document.createElement('span');
        label.textContent = `≤ ${bucket.minutes} min`;
        const value = document.createElement('strong');
        value.textContent = String(bucket.localityCount);
        metric.append(label, value);
        return metric;
      }),
    );
    reachableFilter.disabled = false;
    renderReachableList();
    renderDestination();
    updateDiagnostics(totalMilliseconds);
    calculationStatus.textContent = `Calculated in ${totalMilliseconds.toFixed(1)} ms.`;
  };

  initializeLocalityAutocomplete(
    requireElement('origin-search', HTMLInputElement),
    requireElement('origin-results', HTMLDivElement),
    data.localities,
    (locality) => {
      clearCalculationView();
      if (locality === undefined) {
        model.clearOrigin();
        selectionMode.textContent = 'No origin selected';
        fallbackWarning.hidden = true;
        hubCandidates.className = 'empty-state';
        hubCandidates.textContent =
          'Select an origin to inspect its ranked hubs and stops.';
        calculationStatus.textContent = 'Select a known origin locality.';
      } else {
        renderHubs(locality.localityId);
      }
      renderDestination();
    },
  );

  initializeLocalityAutocomplete(
    requireElement('destination-search', HTMLInputElement),
    requireElement('destination-results', HTMLDivElement),
    data.localities,
    (locality) => {
      destinationLocalityId = locality?.localityId;
      model.selectDestination(destinationLocalityId);
      renderDestination();
    },
  );

  travelSlider.addEventListener('input', () => {
    updateTravelLabel();
    clearCalculationView();
    renderDestination();
  });
  reachableFilter.addEventListener('input', renderReachableList);
  calculateButton.addEventListener('click', () => {
    calculateButton.disabled = true;
    try {
      const start = performance.now();
      const calculation = model.calculate(travelSlider.valueAsNumber);
      renderCalculation(calculation, performance.now() - start);
    } catch (error) {
      calculationStatus.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      calculateButton.disabled = false;
    }
  });
}

try {
  main();
} catch (error) {
  console.error(error);
  const startupError = document.getElementById('startup-error');
  if (startupError !== null) {
    startupError.hidden = false;
    startupError.textContent =
      error instanceof Error ? error.message : String(error);
  }
}
