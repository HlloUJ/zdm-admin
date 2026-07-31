<template>
  <section :class="['zdm-admin-section-card', `zdm-admin-section-card--${variant}`]">
    <slot />
  </section>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'filter' | 'table' | 'plain';
  }>(),
  { variant: 'plain' },
);
</script>

<style scoped>
.zdm-admin-section-card {
  padding: var(--zdm-admin-card-padding);
  background: var(--td-bg-color-container);
  border-radius: var(--zdm-admin-card-radius);
  box-shadow: var(--td-shadow-1);
}

.zdm-admin-section-card--filter,
.zdm-admin-section-card--table {
  margin-bottom: var(--zdm-admin-section-gap);
}
</style>
