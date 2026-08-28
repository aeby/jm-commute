<script setup lang="ts">
import type { FastestWindowResult } from '@core/transit/raptor/routing/types';
import { computed, ref, shallowRef } from 'vue';

import CommuteMap from './components/CommuteMap.vue';
import CommuteTimeSlider from './components/CommuteTimeSlider.vue';
import LocalityAutocomplete from './components/LocalityAutocomplete.vue';
import { VIEWER_CONFIG } from './config';
import {
  loadGeneratedCommuteViewerData,
  type ViewerLocality,
  type ViewerRuntimeData,
} from './data/runtime-data';
import type {
  ReachabilityHex,
  ReachabilityHexFeatureCollection,
  ReachableStopSample,
} from './map/reachability-hexes';
import {
  countVisibleReachabilityHexes,
  countVisibleReachableStops,
  createBrowserViewerRoutingEngine,
  ViewerOriginRoutingCoordinator,
  type ViewerRoutingOutcome,
} from './viewer-routing';

type CalculationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'calculating' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string };

const emptyFeatureCollection = (): ReachabilityHexFeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

const runtimeData = shallowRef<ViewerRuntimeData>();
const startupError = ref<string>();
const selectedLocality = ref<ViewerLocality>();
const selectedCommuteMinutes = ref(
  VIEWER_CONFIG.commute.defaultMinutes,
);
const routingResult = shallowRef<FastestWindowResult>();
const calculationState = ref<CalculationState>({ kind: 'idle' });

const reachableStopSamples = shallowRef<readonly ReachableStopSample[]>([]);
const reachabilityHexes = shallowRef<readonly ReachabilityHex[]>([]);
const featureCollection = shallowRef<ReachabilityHexFeatureCollection>(
  emptyFeatureCollection(),
);
const routingOutcome = shallowRef<ViewerRoutingOutcome>();
const sourceUpdateMilliseconds = ref<number>();
const mapErrorMessage = ref<string>();

let routingCoordinator: ViewerOriginRoutingCoordinator | undefined;

try {
  const loaded = loadGeneratedCommuteViewerData();
  runtimeData.value = loaded;
  routingCoordinator = new ViewerOriginRoutingCoordinator(
    createBrowserViewerRoutingEngine(loaded),
    loaded.stopCoordinates,
  );
  selectedLocality.value =
    loaded.localities.find(
      ({ localityId }) => localityId === '3011:bern',
    ) ?? loaded.localities[0];
} catch (error) {
  startupError.value = error instanceof Error ? error.message : String(error);
}

const localityEntriesById = computed(
  () =>
    new Map(
      runtimeData.value?.localityRoutingIndex.entries.map((entry) => [
        entry.localityId,
        entry,
      ]) ?? [],
    ),
);

const originPoint = computed(() => {
  const locality = selectedLocality.value;
  return locality === undefined
    ? undefined
    : { longitude: locality.longitude, latitude: locality.latitude };
});
const originLabel = computed(() =>
  selectedLocality.value === undefined
    ? ''
    : `${selectedLocality.value.postalCode} ${selectedLocality.value.city}`,
);
const visibleReachableStopCount = computed(() =>
  countVisibleReachableStops(
    reachableStopSamples.value,
    selectedCommuteMinutes.value,
  ),
);
const visibleHexagonCount = computed(() =>
  countVisibleReachabilityHexes(
    reachabilityHexes.value,
    selectedCommuteMinutes.value,
  ),
);

function clearRoutingResult(): void {
  routingResult.value = undefined;
  routingOutcome.value = undefined;
  reachableStopSamples.value = [];
  reachabilityHexes.value = [];
  featureCollection.value = emptyFeatureCollection();
  sourceUpdateMilliseconds.value = undefined;
}

async function calculateReachability(locality: ViewerLocality): Promise<void> {
  const coordinator = routingCoordinator;
  const entry = localityEntriesById.value.get(locality.localityId);
  clearRoutingResult();
  calculationState.value = { kind: 'calculating' };

  if (coordinator === undefined || entry === undefined) {
    calculationState.value = {
      kind: 'error',
      message: `Routing data is missing locality "${locality.localityId}".`,
    };
    return;
  }

  try {
    const outcome = await coordinator.calculateOrigin(entry);
    if (
      outcome === undefined ||
      selectedLocality.value?.localityId !== outcome.originLocalityId
    ) {
      return;
    }
    routingResult.value = outcome.routingResult;
    reachableStopSamples.value = outcome.reachableStopSamples;
    reachabilityHexes.value = outcome.hexes;
    featureCollection.value = outcome.featureCollection;
    routingOutcome.value = outcome;
    calculationState.value = { kind: 'ready' };
  } catch (error) {
    if (selectedLocality.value?.localityId !== locality.localityId) {
      return;
    }
    calculationState.value = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function selectLocality(locality: ViewerLocality | undefined): void {
  selectedLocality.value = locality;
  mapErrorMessage.value = undefined;
  if (locality === undefined) {
    routingCoordinator?.invalidate();
    clearRoutingResult();
    calculationState.value = { kind: 'idle' };
    return;
  }
  void calculateReachability(locality);
}

if (selectedLocality.value !== undefined) {
  void calculateReachability(selectedLocality.value);
}
</script>

<template>
  <main class="viewer-page">
    <header class="viewer-header">
      <div class="viewer-brand">
        <p class="viewer-eyebrow">Swiss public transport</p>
        <h1 class="viewer-title">Commute reachability</h1>
        <p class="viewer-subtitle">
          Fastest morning journeys, aggregated into a geographic stop-level view.
        </p>
      </div>

      <section v-if="runtimeData" class="control-deck" aria-label="Map controls">
        <LocalityAutocomplete
          :localities="runtimeData.localities"
          :model-value="selectedLocality"
          @update:model-value="selectLocality"
        />
        <CommuteTimeSlider
          v-model="selectedCommuteMinutes"
          :minimum="VIEWER_CONFIG.commute.minimumMinutes"
          :maximum="VIEWER_CONFIG.commute.maximumMinutes"
          :step="VIEWER_CONFIG.commute.stepMinutes"
        />
      </section>
    </header>

    <section v-if="startupError" class="startup-error" role="alert">
      <div>
        <h2>Viewer data is unavailable</h2>
        <p>{{ startupError }}</p>
      </div>
    </section>

    <template v-else-if="runtimeData">
      <div class="viewer-content">
        <CommuteMap
          :origin="originPoint"
          :origin-label="originLabel"
          :hexes="reachabilityHexes"
          :feature-collection="featureCollection"
          :selected-minutes="selectedCommuteMinutes"
          :calculating="calculationState.kind === 'calculating'"
          @map-error="mapErrorMessage = $event"
          @source-update="sourceUpdateMilliseconds = $event"
        />

        <p
          v-if="calculationState.kind === 'error'"
          class="calculation-error"
          role="alert"
        >
          {{ calculationState.message }}
        </p>
      </div>

      <div class="diagnostics" aria-label="Viewer diagnostics">
        <dl class="diagnostic">
          <dt>Routing time</dt>
          <dd>
            {{ routingOutcome ? `${routingOutcome.timings.raptorMilliseconds.toFixed(1)} ms` : '—' }}
          </dd>
        </dl>
        <dl class="diagnostic">
          <dt>Reachable stops</dt>
          <dd>{{ routingResult ? visibleReachableStopCount.toLocaleString() : '—' }}</dd>
        </dl>
        <dl class="diagnostic">
          <dt>Hexagon count</dt>
          <dd>{{ routingResult ? visibleHexagonCount.toLocaleString() : '—' }}</dd>
        </dl>
        <dl class="diagnostic">
          <dt>Selected maximum</dt>
          <dd>{{ selectedCommuteMinutes }} min</dd>
        </dl>
        <span v-if="routingOutcome" class="diagnostics-detail">
          Stops {{ routingOutcome.timings.stopSamplingMilliseconds.toFixed(1) }} ms ·
          hexes {{ routingOutcome.timings.hexAggregationMilliseconds.toFixed(1) }} ms ·
          GeoJSON {{ routingOutcome.timings.geoJsonMilliseconds.toFixed(1) }} ms ·
          source {{ sourceUpdateMilliseconds?.toFixed(1) ?? '—' }} ms
        </span>
        <span v-else-if="mapErrorMessage" class="diagnostics-detail">
          Map unavailable
        </span>
      </div>
    </template>
  </main>
</template>
