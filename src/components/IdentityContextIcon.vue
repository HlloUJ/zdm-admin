<template>
  <svg
    v-if="name === 'storefront'"
    class="identity-glyph"
    data-kind="storefront"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 10v11h16V10M3 8l2-5h14l2 5v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V8Z" />
    <path d="M9 21v-7h6v7" />
  </svg>
  <t-icon
    v-else
    :name="name"
    class="identity-glyph"
    :data-kind="name"
    size="var(--td-comp-size-xs)"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
defineProps<{ name: 'storefront' | 'city-8' | 'city' }>();
</script>

<style scoped>
.identity-glyph {
  width: var(--td-comp-size-xs);
  height: var(--td-comp-size-xs);
  flex: none;
}
</style>
