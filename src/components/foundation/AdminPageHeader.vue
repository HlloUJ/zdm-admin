<template>
  <div class="page-header admin-page-header">
    <div class="admin-page-header__main">
      <t-breadcrumb v-if="breadcrumbs.length > 1" class="admin-page-header__breadcrumb">
        <t-breadcrumb-item v-for="item in breadcrumbs" :key="item">{{ item }}</t-breadcrumb-item>
      </t-breadcrumb>
      <h1>{{ title }}</h1>
    </div>
    <t-tag v-if="badge" theme="primary" variant="light">{{ badge }}</t-tag>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    breadcrumbs?: string[];
    badge?: string;
  }>(),
  {
    breadcrumbs: () => [],
    badge: '',
  },
);

const title = computed(() => props.breadcrumbs.at(-1) || '');
</script>
