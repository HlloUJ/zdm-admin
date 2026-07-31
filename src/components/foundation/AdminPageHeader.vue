<template>
  <header class="zdm-admin-page-header">
    <slot v-if="$slots.default" />
    <template v-else>
      <t-breadcrumb>
        <t-breadcrumb-item v-for="item in breadcrumbs" :key="item">{{ item }}</t-breadcrumb-item>
      </t-breadcrumb>
      <t-tag v-if="badge" theme="primary" variant="light">{{ badge }}</t-tag>
    </template>
    <slot name="extra" />
  </header>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    breadcrumbs?: string[];
    badge?: string;
  }>(),
  { breadcrumbs: () => [], badge: '' },
);
</script>
