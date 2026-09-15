<script setup lang="ts">
import { computed } from 'vue';

import { type Tab, TABS } from '../lib/tabs.js';

const active = defineModel<Tab>({ required: true });

// Drives the sliding indicator — its offset is the active tab's index, so the pill animates between
// positions instead of the highlight jumping.
const activeIndex = computed(() => TABS.findIndex(([id]) => id === active.value));
</script>

<template>
  <nav
    class="relative grid gap-1"
    :style="{ gridTemplateColumns: `repeat(${TABS.length}, minmax(0, 1fr))` }"
  >
    <!-- Equal columns share the gaps; each indicator step is one column plus one gap. -->
    <span
      class="absolute inset-y-0 left-0 rounded-md bg-raised transition-transform duration-200 ease-standard"
      :style="{
        width: `calc(${100 / TABS.length}% - ${((TABS.length - 1) * 0.25) / TABS.length}rem)`,
        transform: `translateX(calc(${activeIndex} * (100% + 0.25rem)))`,
      }"
    />
    <button
      v-for="[id, label] in TABS"
      :key="id"
      class="relative rounded-md py-1 text-panel transition-colors duration-150"
      :class="active === id ? 'font-medium text-fg' : 'text-dim hover:text-fg'"
      @click="active = id"
    >
      {{ label }}
    </button>
  </nav>
</template>
