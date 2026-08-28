<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { Locality } from '../api/types';
import { VIEWER_CONFIG } from '../config';
import {
  formatLocality,
  searchLocalities,
} from '../locality-search';

const props = defineProps<{
  readonly localities: readonly Locality[];
  readonly modelValue: Locality | undefined;
  readonly disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [locality: Locality | undefined];
}>();

const query = ref('');
const focused = ref(false);
const activeIndex = ref(0);
const input = ref<HTMLInputElement>();

const matches = computed(() =>
  searchLocalities(
    props.localities,
    query.value,
    VIEWER_CONFIG.autocomplete.resultLimit,
  ),
);
const resultsOpen = computed(
  () => focused.value && query.value.trim().length > 0,
);
const activeOptionId = computed(() =>
  matches.value[activeIndex.value] === undefined
    ? undefined
    : `locality-option-${activeIndex.value}`,
);

watch(
  () => props.modelValue,
  (locality) => {
    if (locality !== undefined) {
      query.value = formatLocality(locality);
    } else if (!focused.value) {
      query.value = '';
    }
  },
  { immediate: true },
);

watch(matches, (currentMatches) => {
  if (activeIndex.value >= currentMatches.length) {
    activeIndex.value = Math.max(0, currentMatches.length - 1);
  }
});

function handleInput(event: Event): void {
  if (!(event.currentTarget instanceof HTMLInputElement)) {
    return;
  }
  query.value = event.currentTarget.value;
  activeIndex.value = 0;
}

function selectLocality(locality: Locality): void {
  query.value = formatLocality(locality);
  focused.value = false;
  emit('update:modelValue', locality);
  void nextTick(() => input.value?.blur());
}

function moveActive(offset: number): void {
  const count = matches.value.length;
  if (count === 0) {
    return;
  }
  activeIndex.value = (activeIndex.value + offset + count) % count;
}

function handleKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      moveActive(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveActive(-1);
      break;
    case 'Enter': {
      const locality = matches.value[activeIndex.value];
      if (resultsOpen.value && locality !== undefined) {
        event.preventDefault();
        selectLocality(locality);
      }
      break;
    }
    case 'Escape':
      focused.value = false;
      query.value = props.modelValue
        ? formatLocality(props.modelValue)
        : '';
      input.value?.blur();
      break;
  }
}

function handleBlur(): void {
  window.setTimeout(() => {
    focused.value = false;
    query.value = props.modelValue
      ? formatLocality(props.modelValue)
      : '';
  }, 100);
}
</script>

<template>
  <div class="locality-control">
    <div class="control-heading">
      <label for="origin-locality">Location</label>
    </div>
    <div class="autocomplete">
      <div class="autocomplete-input-wrap">
        <input
          id="origin-locality"
          ref="input"
          :value="query"
          :aria-activedescendant="activeOptionId"
          :aria-expanded="resultsOpen"
          aria-autocomplete="list"
          aria-controls="locality-results"
          aria-haspopup="listbox"
          autocomplete="off"
          class="autocomplete-input"
          :disabled="disabled"
          placeholder="ZIP or city"
          role="combobox"
          type="text"
          @blur="handleBlur"
          @focus="focused = true"
          @input="handleInput"
          @keydown="handleKeydown"
        />
      </div>

      <ul
        v-if="resultsOpen"
        id="locality-results"
        class="autocomplete-results"
        role="listbox"
      >
        <li
          v-for="(locality, index) in matches"
          :id="`locality-option-${index}`"
          :key="locality.localityId"
          :aria-selected="index === activeIndex"
          role="option"
        >
          <button
            :class="['autocomplete-option', { 'is-active': index === activeIndex }]"
            type="button"
            tabindex="-1"
            @mousedown.prevent
            @mouseenter="activeIndex = index"
            @click="selectLocality(locality)"
          >
            <span class="autocomplete-postal-code">{{ locality.postalCode }}</span>
            <span class="autocomplete-city">{{ locality.city }}</span>
          </button>
        </li>
        <li v-if="matches.length === 0" class="autocomplete-empty" role="option">
          No matching Swiss locality
        </li>
      </ul>
    </div>
  </div>
</template>
