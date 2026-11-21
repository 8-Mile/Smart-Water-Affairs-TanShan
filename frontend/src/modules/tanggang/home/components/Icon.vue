<script setup lang="ts">
const paths = {
  arrow: 'M6 17 17 6 M7.5 6H17v9.5',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  sliders: 'M3 7h7m4 0h7M3 17h11m4 0h3 M10 4v6m4 4v6',
  truck: 'M2 6h12v11H2z M14 9h4l4 4v4h-8 M5 18a2 2 0 1 0 4 0 M16 18a2 2 0 1 0 4 0',
  box: 'm12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M8 5l9 5',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 1 1 0-18 M12 7v5l3 2',
  check: 'm4 12 5 5L20 6',
  trend: 'm3 17 6-6 4 3 8-9m-6 0h6v6',
  layers: 'm12 3 9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
  search: 'M10 3a7 7 0 1 1 0 14 7 7 0 1 1 0-14 M15 15l6 6',
  back: 'm14 5-7 7 7 7',
  pin: 'M12 21s7-7 7-12A7 7 0 0 0 5 9c0 5 7 12 7 12z M12 7a2 2 0 1 1 0 4 2 2 0 1 1 0-4',
}
export type IconName = keyof typeof paths
defineProps<{ name: IconName }>()
</script>
<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name]" />
  </svg>
</template>
