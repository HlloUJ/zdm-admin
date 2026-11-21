<script setup>
defineProps({ name: { type: String, required: true } });
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <g v-if="name === 'finished'">
      <path d="m3 8 3-5h12l3 5v3H3V8ZM3 8h18M6 11v10m12-10v10" />
    </g>
    <g v-else-if="name === 'accessory'">
      <path d="M7 13V3h10v10M3 13h18v4H3zM5 17v4m14-4v4M7 8h10" />
    </g>
    <g v-else>
      <path d="m3 8 2-5h14l2 5v13H3V8ZM3 8h18M3 8c0 3 6 3 6 0 0 3 6 3 6 0 0 3 6 3 6 0" />
      <path v-if="name === 'added'" d="m8 16 3 2 5-5" />
      <path v-else d="m9 14 6 5m0-5-6 5" />
    </g>
  </svg>
</template>
