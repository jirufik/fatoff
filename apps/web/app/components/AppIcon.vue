<script setup lang="ts">
/**
 * Набор значков — контурные, одной толщиной, наследуют цвет текста.
 *
 * Своей горсткой путей вместо библиотеки: их полтора десятка, и тащить ради
 * этого зависимость с тысячей значков незачем (та же причина, что у D-011).
 */
const PATHS: Record<string, string> = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2M14 4v4M8 10v4M14 16v4',
  bookmark: 'M6 4h12v16l-6-4-6 4V4Z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
  dumbbell: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
  meal: 'M6 3v8a2 2 0 0 0 4 0V3M8 11v10M15 3c-1 2-1 5 0 7v11',
  flame: 'M12 21c3.3 0 6-2.5 6-5.6 0-3.9-4-5.6-3-10.4-2.5 1-5 4-5 7 0-1-1-2-2-2.6-.6 1.3-2 2.9-2 6C6 18.5 8.7 21 12 21Z',
  gauge: 'M20 16a8 8 0 1 0-16 0M12 12l4-3',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  steps: 'M7 5c1.5 0 2.5 1 2.5 2.5S8.5 13 8.5 15H5c0-2 .5-4 .5-6C5.5 6.5 5.5 5 7 5ZM17 9c1.5 0 2.5 1 2.5 2.5S18.5 17 18.5 19H15c0-2 .5-4 .5-6C15.5 10.5 15.5 9 17 9Z',
  archive: 'M3 6h18v4H3zM5 10v10h14V10M9 14h6',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  pin: 'M12 17v5M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Z',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16v4Z',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  check: 'M4 12l5 5L20 6',
  external: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  save: 'M5 4h11l3 3v13H5zM8 4v6h8V6M8 15h8',
  play: 'M7 4l12 8-12 8V4Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
}
withDefaults(defineProps<{ name: keyof typeof PATHS | string; size?: number }>(), { size: 16 })
</script>

<template>
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="PATHS[name] ?? PATHS.info" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  vertical-align: -0.15em;
}
</style>
