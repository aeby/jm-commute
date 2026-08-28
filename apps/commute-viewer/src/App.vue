<script setup lang="ts">
import {
  computed,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { CommuteApiClient } from './api/commute-api-client';
import type {
  CommuteMode,
  Locality,
  ReachabilityFeatureCollection,
  ReachabilityResponse,
} from './api/types';
import CommuteMap from './components/CommuteMap.vue';
import CommuteTimeSlider from './components/CommuteTimeSlider.vue';
import LocalityAutocomplete from './components/LocalityAutocomplete.vue';
import { VIEWER_CONFIG } from './config';
import {
  countVisibleHexagons,
  ViewerReachabilityCoordinator,
} from './viewer-controller';

const EMPTY_FEATURE_COLLECTION: ReachabilityFeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const apiClient = new CommuteApiClient({
  baseUrl: VIEWER_CONFIG.api.baseUrl,
});
const reachabilityCoordinator = new ViewerReachabilityCoordinator(apiClient);

const localities = shallowRef<readonly Locality[]>([]);
const selectedLocalityId = ref<string>();
const selectedMode = ref<CommuteMode>('transit');
const selectedCommuteMinutes = ref(VIEWER_CONFIG.commute.defaultMinutes);
const reachabilityResponse = shallowRef<ReachabilityResponse>();

const loadingLocalities = ref(true);
const localitiesError = ref<string>();
const loadingReachability = ref(false);
const reachabilityError = ref<string>();
const requestMilliseconds = ref<number>();
const sourceUpdateMilliseconds = ref<number>();
const mapErrorMessage = ref<string>();

let reachabilityLoadGeneration = 0;

const localitiesById = computed(
  () => new Map(localities.value.map((locality) => [locality.localityId, locality])),
);
const selectedLocality = computed(() =>
  selectedLocalityId.value === undefined
    ? undefined
    : localitiesById.value.get(selectedLocalityId.value),
);
const featureCollection = computed(
  () => reachabilityResponse.value?.geojson ?? EMPTY_FEATURE_COLLECTION,
);
const visibleHexagonCount = computed(() =>
  countVisibleHexagons(
    featureCollection.value,
    selectedCommuteMinutes.value,
  ),
);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadLocalities(): Promise<void> {
  loadingLocalities.value = true;
  localitiesError.value = undefined;
  try {
    const loaded = await apiClient.loadLocalities();
    localities.value = loaded;
    selectedLocalityId.value ??=
      (loaded.find(({ localityId }) => localityId === '3011:bern') ?? loaded[0])
        ?.localityId;
  } catch (error) {
    localitiesError.value = errorMessage(error);
  } finally {
    loadingLocalities.value = false;
  }
}

async function loadReachability(): Promise<void> {
  const locality = selectedLocality.value;
  if (locality === undefined) {
    reachabilityCoordinator.invalidate();
    return;
  }

  const generation = ++reachabilityLoadGeneration;
  loadingReachability.value = true;
  reachabilityError.value = undefined;
  try {
    const outcome = await reachabilityCoordinator.load(
      locality.localityId,
      selectedMode.value,
    );
    if (outcome === undefined || generation !== reachabilityLoadGeneration) {
      return;
    }
    reachabilityResponse.value = outcome.response;
    requestMilliseconds.value = outcome.requestMilliseconds;
  } catch (error) {
    if (generation === reachabilityLoadGeneration) {
      reachabilityError.value = errorMessage(error);
    }
  } finally {
    if (generation === reachabilityLoadGeneration) {
      loadingReachability.value = false;
    }
  }
}

function selectLocality(locality: Locality | undefined): void {
  if (locality !== undefined) {
    selectedLocalityId.value = locality.localityId;
    mapErrorMessage.value = undefined;
  }
}

watch(
  [selectedLocalityId, selectedMode],
  () => void loadReachability(),
);

onUnmounted(() => {
  reachabilityLoadGeneration += 1;
  reachabilityCoordinator.invalidate();
});

void loadLocalities();
</script>

<template>
  <main class="viewer-page">
    <header class="viewer-header">
      <div class="viewer-brand">
        <p class="viewer-eyebrow">Switzerland · car and public transport</p>
        <h1 class="viewer-title">Commute reachability</h1>
        <p class="viewer-subtitle">
          Explore precomputed morning travel times across canonical Swiss localities.
        </p>
      </div>

      <section
        v-if="localities.length > 0"
        class="control-deck"
        aria-label="Map controls"
      >
        <LocalityAutocomplete
          :localities="localities"
          :model-value="selectedLocality"
          :disabled="loadingLocalities"
          @update:model-value="selectLocality"
        />

        <fieldset class="transport-control">
          <legend class="control-label">Transport</legend>
          <div class="transport-options">
            <label class="transport-option">
              <input v-model="selectedMode" type="radio" value="transit" />
              <span>Public transport</span>
            </label>
            <label class="transport-option">
              <input v-model="selectedMode" type="radio" value="car" />
              <span>Car</span>
            </label>
          </div>
        </fieldset>

        <CommuteTimeSlider
          v-model="selectedCommuteMinutes"
          :minimum="VIEWER_CONFIG.commute.minimumMinutes"
          :maximum="VIEWER_CONFIG.commute.maximumMinutes"
          :step="VIEWER_CONFIG.commute.stepMinutes"
        />
      </section>
    </header>

    <section v-if="loadingLocalities" class="startup-loading" role="status">
      <p><span class="spinner" aria-hidden="true"></span>Loading localities…</p>
    </section>

    <section v-else-if="localitiesError" class="startup-error" role="alert">
      <div>
        <h2>Localities are unavailable</h2>
        <p>{{ localitiesError }}</p>
        <button class="retry-button" type="button" @click="loadLocalities">
          Try again
        </button>
      </div>
    </section>

    <template v-else-if="selectedLocality">
      <div class="viewer-content">
        <CommuteMap
          :origin="selectedLocality"
          :feature-collection="featureCollection"
          :selected-minutes="selectedCommuteMinutes"
          :loading="loadingReachability"
          @map-error="mapErrorMessage = $event"
          @source-update="sourceUpdateMilliseconds = $event"
        />

        <div
          v-if="reachabilityError"
          class="calculation-error"
          role="alert"
        >
          {{ reachabilityError }}
          <button class="retry-button retry-button--inline" type="button" @click="loadReachability">
            Retry
          </button>
        </div>
      </div>

      <div class="diagnostics" aria-label="Viewer diagnostics">
        <dl class="diagnostic">
          <dt>Mode</dt>
          <dd>{{ selectedMode === 'transit' ? 'Public transport' : 'Car' }}</dd>
        </dl>
        <dl class="diagnostic">
          <dt>Maximum</dt>
          <dd>{{ selectedCommuteMinutes }} min</dd>
        </dl>
        <dl class="diagnostic">
          <dt>Reachable localities</dt>
          <dd>{{ reachabilityResponse?.reachableLocalityCount.toLocaleString() ?? '—' }}</dd>
        </dl>
        <dl class="diagnostic">
          <dt>Visible hexagons</dt>
          <dd>{{ visibleHexagonCount.toLocaleString() }}</dd>
        </dl>
        <dl class="diagnostic">
          <dt>Total hexagons</dt>
          <dd>{{ reachabilityResponse?.hexagonCount.toLocaleString() ?? '—' }}</dd>
        </dl>
        <span class="diagnostics-detail">
          API {{ requestMilliseconds?.toFixed(1) ?? '—' }} ms ·
          map source {{ sourceUpdateMilliseconds?.toFixed(1) ?? '—' }} ms
          <template v-if="mapErrorMessage"> · map unavailable</template>
        </span>
      </div>
    </template>
  </main>
</template>
