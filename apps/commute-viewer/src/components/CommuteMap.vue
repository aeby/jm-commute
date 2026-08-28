<script setup lang="ts">
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  onMounted,
  onUnmounted,
  shallowRef,
  watch,
} from 'vue';

import { VIEWER_CONFIG } from '../config';
import { calculateVisibleMapBounds } from '../map/map-bounds';
import {
  applyOriginMapUpdate,
  applySliderMapUpdate,
} from '../map/map-update-actions';
import type {
  ReachabilityHex,
  ReachabilityHexFeatureCollection,
} from '../map/reachability-hexes';

const HEX_SOURCE_ID = 'commute-hexes';
const HEX_FILL_LAYER_ID = 'commute-hex-fill';
const HEX_OUTLINE_LAYER_ID = 'commute-hex-outline';
const MAP_LOAD_TIMEOUT_MILLISECONDS = 15_000;

interface OriginPoint {
  readonly longitude: number;
  readonly latitude: number;
}

const props = defineProps<{
  readonly origin: OriginPoint | undefined;
  readonly originLabel: string;
  readonly hexes: readonly ReachabilityHex[];
  readonly featureCollection: ReachabilityHexFeatureCollection;
  readonly selectedMinutes: number;
  readonly calculating: boolean;
}>();

const emit = defineEmits<{
  mapError: [message: string | undefined];
  sourceUpdate: [milliseconds: number];
}>();

const container = shallowRef<HTMLElement>();
const map = shallowRef<maplibregl.Map>();
const originMarker = shallowRef<maplibregl.Marker>();
const mapError = shallowRef<string>();

let fitTimeout: ReturnType<typeof setTimeout> | undefined;
let loadTimeout: ReturnType<typeof setTimeout> | undefined;
let resizeObserver: ResizeObserver | undefined;
let sourceUpdateGeneration = 0;
let styleReady = false;

const durationFilter = (
  maximumMinutes: number,
): Parameters<maplibregl.Map['setFilter']>[1] => [
  '<=',
  ['get', 'travelMinutes'],
  maximumMinutes,
];

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
  const currentMap = map.value;
  const source = currentMap?.getSource(HEX_SOURCE_ID);
  if (!(source instanceof maplibregl.GeoJSONSource)) {
    return;
  }

  const generation = ++sourceUpdateGeneration;
  const startedAt = performance.now();
  void source
    .setData(props.featureCollection, true)
    .then(() => {
      if (generation === sourceUpdateGeneration) {
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
    originMarker.value = new maplibregl.Marker({
      element: markerElement,
      anchor: 'left',
      offset: [-9, 0],
    })
      .setLngLat([origin.longitude, origin.latitude])
      .addTo(currentMap);
  }

  const markerElement = originMarker.value.getElement();
  const label = markerElement.querySelector('.origin-marker__label');
  if (label !== null) {
    label.textContent = props.originLabel;
  }
  markerElement.setAttribute('aria-label', `Origin: ${props.originLabel}`);
  originMarker.value.setLngLat([origin.longitude, origin.latitude]);
}

function fitVisibleReachability(animate = true): void {
  const currentMap = map.value;
  const origin = props.origin;
  if (currentMap === undefined || origin === undefined) {
    return;
  }

  const visibleHexes = props.hexes.filter(
    ({ travelMinutes }) => travelMinutes <= props.selectedMinutes,
  );
  if (visibleHexes.length === 0) {
    currentMap.easeTo({
      center: [origin.longitude, origin.latitude],
      zoom: 11,
      duration: animate ? 350 : 0,
    });
    return;
  }

  const bounds = calculateVisibleMapBounds(
    origin,
    props.hexes,
    props.selectedMinutes,
  );
  currentMap.fitBounds(
    [
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ],
    {
      padding: 52,
      maxZoom: 13,
      duration: animate ? 450 : 0,
    },
  );
}

function scheduleOriginFit(): void {
  if (fitTimeout !== undefined) {
    clearTimeout(fitTimeout);
  }
  fitTimeout = setTimeout(() => {
    fitTimeout = undefined;
    fitVisibleReachability();
  }, 0);
}

function addReachabilityLayers(currentMap: maplibregl.Map): void {
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
          '#0a665f',
          30,
          '#138f84',
          60,
          '#3aaba1',
          90,
          '#78c9c1',
          120,
          '#b7e3de',
        ],
        'fill-opacity': 0.57,
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
        'line-color': '#075f59',
        'line-opacity': 0.55,
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

  let currentMap: maplibregl.Map;
  try {
    currentMap = new maplibregl.Map({
      container: container.value,
      style: VIEWER_CONFIG.map.styleUrl,
      center: props.origin
        ? [props.origin.longitude, props.origin.latitude]
        : [8.23, 46.82],
      zoom: props.origin ? 11 : 7,
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
    scheduleOriginFit();
  });
  currentMap.on('error', (event) => {
    if (!styleReady) {
      reportMapError(
        `The basemap could not be loaded: ${event.error.message}`,
      );
    }
  });

  resizeObserver = new ResizeObserver(() => currentMap.resize());
  resizeObserver.observe(container.value);
});

watch(
  () => props.featureCollection,
  () => {
    updateSource();
  },
);
watch(
  () => props.selectedMinutes,
  () => {
    applySliderMapUpdate({ updateHexVisibility: updateFilter });
  },
);
watch(
  () => [props.origin, props.originLabel] as const,
  () => {
    applyOriginMapUpdate({
      updateOriginMarker,
      updateCamera: scheduleOriginFit,
    });
  },
);

onUnmounted(() => {
  sourceUpdateGeneration += 1;
  if (fitTimeout !== undefined) {
    clearTimeout(fitTimeout);
  }
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
  <section class="map-panel" aria-label="Public-transport commute reachability map">
    <div ref="container" class="map-canvas"></div>

    <div v-if="calculating" class="map-status" role="status">
      <span class="spinner" aria-hidden="true"></span>
      Calculating reachability…
    </div>

    <div v-if="mapError" class="map-error" role="alert">
      {{ mapError }}
    </div>

    <div class="map-legend" aria-label="Travel-time color legend">
      <span class="legend-title">Travel time</span>
      <span class="legend-gradient" aria-hidden="true"></span>
      <span class="legend-labels">
        <span>15m</span>
        <span>30m</span>
        <span>60m</span>
        <span>90m</span>
        <span>120m</span>
      </span>
    </div>
  </section>
</template>
