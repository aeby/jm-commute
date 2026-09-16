<script setup lang="ts">
import { GeoJSONSource, Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onMounted, onUnmounted, shallowRef, watch } from 'vue';

import type {
  Locality,
  ReachabilityFeatureCollection,
} from '../api/types';
import { VIEWER_CONFIG } from '../config';
import {
  applyOriginMapUpdate,
  applySliderMapUpdate,
} from '../map/map-update-actions';

const HEX_SOURCE_ID = 'commute-hexes';
const HEX_FILL_LAYER_ID = 'commute-hex-fill';
const HEX_OUTLINE_LAYER_ID = 'commute-hex-outline';
const MAP_LOAD_TIMEOUT_MILLISECONDS = 15_000;
const ORIGIN_ZOOM = 10.5;

const props = defineProps<{
  readonly origin: Locality | undefined;
  readonly featureCollection: ReachabilityFeatureCollection;
  readonly selectedMinutes: number;
  readonly loading: boolean;
}>();

const emit = defineEmits<{
  (event: 'mapError', message: string | undefined): void;
  (event: 'sourceUpdate', milliseconds: number): void;
}>();

const container = shallowRef<HTMLElement>();
const map = shallowRef<MapLibreMap>();
const originMarker = shallowRef<Marker>();
const mapError = shallowRef<string>();

let loadTimeout: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined;
let sourceUpdateGeneration = 0;
let styleReady = false;

function durationFilter(
  maximumMinutes: number,
): Parameters<MapLibreMap['setFilter']>[1] {
  return ['<=', ['get', 'travelMinutes'], maximumMinutes];
}

function reportMapError(message: string): void {
  mapError.value = message;
  emit('mapError', message);
}

function updateFilter(): void {
  const currentMap = map.value;
  if (
    currentMap === undefined ||
    currentMap.getLayer(HEX_FILL_LAYER_ID) === undefined
  ) {
    return;
  }

  const filter = durationFilter(props.selectedMinutes);
  currentMap.setFilter(HEX_FILL_LAYER_ID, filter);
  currentMap.setFilter(HEX_OUTLINE_LAYER_ID, filter);
}

function updateSource(): void {
  const source = map.value?.getSource(HEX_SOURCE_ID);
  if (!(source instanceof GeoJSONSource)) {
    return;
  }

  const generation = ++sourceUpdateGeneration;
  const startedAt = performance.now();
  void source
    .setData(props.featureCollection, true)
    .then(() => {
      if (generation === sourceUpdateGeneration) {
        mapError.value = undefined;
        emit('mapError', undefined);
        emit('sourceUpdate', performance.now() - startedAt);
      }
    })
    .catch((error: unknown) => {
      reportMapError(
        `The commute overlay could not be updated: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

function updateOriginMarker(): void {
  const currentMap = map.value;
  const origin = props.origin;
  if (currentMap === undefined || origin === undefined) {
    originMarker.value?.remove();
    originMarker.value = undefined;
    return;
  }

  if (originMarker.value === undefined) {
    const markerElement = document.createElement('div');
    markerElement.className = 'origin-marker';
    const dot = document.createElement('span');
    dot.className = 'origin-marker__dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'origin-marker__label';
    markerElement.append(dot, label);
    originMarker.value = new Marker({
      element: markerElement,
      anchor: 'left',
      offset: [-9, 0],
    })
      .setLngLat([origin.longitude, origin.latitude])
      .addTo(currentMap);
  }

  const markerElement = originMarker.value.getElement();
  const label = markerElement.querySelector('.origin-marker__label');
  const originLabel = `${origin.postalCode} ${origin.city}`;
  if (label !== null) {
    label.textContent = originLabel;
  }
  markerElement.setAttribute('aria-label', `Origin: ${originLabel}`);
  originMarker.value.setLngLat([origin.longitude, origin.latitude]);
}

function centerOrigin(): void {
  const currentMap = map.value;
  const origin = props.origin;
  if (currentMap === undefined || origin === undefined || !styleReady) {
    return;
  }
  currentMap.easeTo({
    center: [origin.longitude, origin.latitude],
    zoom: ORIGIN_ZOOM,
    duration: 400,
  });
}

function addReachabilityLayers(currentMap: MapLibreMap): void {
  const firstSymbolLayerId = currentMap
    .getStyle()
    .layers?.find(({ type }) => type === 'symbol')?.id;
  const startedAt = performance.now();

  currentMap.addSource(HEX_SOURCE_ID, {
    type: 'geojson',
    data: props.featureCollection,
  });
  currentMap.addLayer(
    {
      id: HEX_FILL_LAYER_ID,
      type: 'fill',
      source: HEX_SOURCE_ID,
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'travelMinutes'],
          0,
          '#6c45ba',
          240,
          '#eb4571',
        ],
        'fill-opacity': 0.6,
      },
    },
    firstSymbolLayerId,
  );
  currentMap.addLayer(
    {
      id: HEX_OUTLINE_LAYER_ID,
      type: 'line',
      source: HEX_SOURCE_ID,
      paint: {
        'line-color': '#52328e',
        'line-opacity': 0.52,
        'line-width': 0.65,
      },
    },
    firstSymbolLayerId,
  );
  emit('sourceUpdate', performance.now() - startedAt);
  updateFilter();
}

onMounted(() => {
  if (container.value === undefined) {
    reportMapError('The map container could not be initialized.');
    return;
  }

  let currentMap: MapLibreMap;
  try {
    currentMap = new MapLibreMap({
      container: container.value,
      style: VIEWER_CONFIG.map.styleUrl,
      center: props.origin
        ? [props.origin.longitude, props.origin.latitude]
        : [8.23, 46.82],
      zoom: props.origin ? ORIGIN_ZOOM : 7,
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
    });
  } catch (error) {
    reportMapError(
      `The map could not be initialized: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  map.value = currentMap;
  currentMap.touchZoomRotate.disableRotation();
  currentMap.keyboard.disableRotation();
  loadTimeout = setTimeout(() => {
    if (!styleReady) {
      reportMapError(
        'The basemap style did not load. Check the network connection and try again.',
      );
    }
  }, MAP_LOAD_TIMEOUT_MILLISECONDS);

  currentMap.on('load', () => {
    styleReady = true;
    if (loadTimeout !== undefined) {
      clearTimeout(loadTimeout);
      loadTimeout = undefined;
    }
    mapError.value = undefined;
    emit('mapError', undefined);
    addReachabilityLayers(currentMap);
    updateOriginMarker();
    centerOrigin();
  });
  currentMap.on('error', (event) => {
    if (!styleReady) {
      reportMapError(`The basemap could not be loaded: ${event.error.message}`);
    }
  });

  resizeObserver = new ResizeObserver(() => currentMap.resize());
  resizeObserver.observe(container.value);
});

watch(() => props.featureCollection, updateSource);
watch(
  () => props.selectedMinutes,
  () => applySliderMapUpdate({ updateHexVisibility: updateFilter }),
);
watch(
  () => props.origin?.localityId,
  () =>
    applyOriginMapUpdate({
      updateOriginMarker,
      updateCamera: centerOrigin,
    }),
);

onUnmounted(() => {
  sourceUpdateGeneration += 1;
  if (loadTimeout !== undefined) {
    clearTimeout(loadTimeout);
  }
  resizeObserver?.disconnect();
  originMarker.value?.remove();
  map.value?.remove();
  originMarker.value = undefined;
  map.value = undefined;
});
</script>

<template>
  <section class="map-panel" aria-label="Commute reachability map">
    <div ref="container" class="map-canvas"></div>

    <div v-if="loading" class="map-status" role="status">
      <span class="spinner" aria-hidden="true"></span>
      Loading reachability…
    </div>

    <div v-if="mapError" class="map-error" role="alert">
      {{ mapError }}
    </div>

    <div class="map-legend" aria-label="Travel-time color legend">
      <span class="legend-title">Travel time</span>
      <span class="legend-gradient" aria-hidden="true"></span>
      <span class="legend-labels">
        <span>30m</span>
        <span>60m</span>
        <span>90m</span>
        <span>2h</span>
        <span>3h</span>
        <span>4h</span>
      </span>
    </div>
  </section>
</template>
