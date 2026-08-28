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
      <label for="commute-time">Commute</label>
      <output for="commute-time">{{ modelValue }} min</output>
    </div>
    <div class="slider-row">
      <span aria-hidden="true">{{ minimum }}</span>
      <input
        id="commute-time"
        :value="modelValue"
        :min="minimum"
        :max="maximum"
        :step="step"
        :aria-valuetext="`${modelValue} minutes`"
        :style="{ '--slider-progress': `${progress}%` }"
        type="range"
        @input="handleInput"
        @change="handleChange"
      />
      <span aria-hidden="true">{{ maximum }} min</span>
    </div>
  </div>
</template>
