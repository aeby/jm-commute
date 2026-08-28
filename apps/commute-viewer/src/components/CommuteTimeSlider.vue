<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  readonly modelValue: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}>();

const emit = defineEmits<{
  'update:modelValue': [minutes: number];
  commit: [minutes: number];
}>();

const progress = computed(
  () =>
    ((props.modelValue - props.minimum) /
      (props.maximum - props.minimum)) *
    100,
);

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  if (minutes % 60 === 0) {
    return `${minutes / 60} h`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function readMinutes(event: Event): number {
  if (!(event.currentTarget instanceof HTMLInputElement)) {
    throw new Error('Commute slider event did not come from an input.');
  }
  return event.currentTarget.valueAsNumber;
}

function handleInput(event: Event): void {
  emit('update:modelValue', readMinutes(event));
}

function handleChange(event: Event): void {
  emit('commit', readMinutes(event));
}
</script>

<template>
  <div class="commute-control">
    <div class="control-heading">
      <label for="commute-time">Maximum commute time</label>
      <output for="commute-time">{{ formatDuration(modelValue) }}</output>
    </div>
    <div class="slider-row">
      <span aria-hidden="true">{{ minimum }}</span>
      <input
        id="commute-time"
        :value="modelValue"
        :min="minimum"
        :max="maximum"
        :step="step"
        :aria-valuetext="formatDuration(modelValue)"
        :style="{ '--slider-progress': `${progress}%` }"
        type="range"
        @input="handleInput"
        @change="handleChange"
      />
      <span aria-hidden="true">{{ maximum }} min</span>
    </div>
  </div>
</template>
